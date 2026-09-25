import type { Prisma } from "@antretix/db";
import type { EventInput, AdminMetrics, QueueStatus } from "@antretix/shared";
import { keys } from "@antretix/shared";
import type { CoreContext } from "./context";
import {
  loadEventMeta,
  readQueueStatus,
  scheduledQueueStatus,
  syncEventToRedis,
  writeEventConfig,
} from "./events";

async function countInWindow(ctx: CoreContext, key: string, sinceMs: number): Promise<number> {
  return ctx.redis.zcount(key, sinceMs, "+inf");
}

async function admitsInWindow(ctx: CoreContext, eventId: string, sinceMs: number): Promise<number> {
  const entries = await ctx.redis.zrangebyscore(keys.admitStats(eventId), sinceMs, "+inf");
  let total = 0;

  for (const entry of entries) {
    const count = Number(entry.split(":")[1] ?? "0");

    if (Number.isFinite(count)) {
      total += count;
    }
  }

  return total;
}

export async function getAdminMetrics(
  ctx: CoreContext,
  eventId: string,
): Promise<AdminMetrics | null> {
  const meta = await loadEventMeta(ctx.prisma, eventId);

  if (meta === null) {
    return null;
  }

  const now = Date.now();
  const minuteAgo = now - 60_000;

  const [
    queueLength,
    activeUsers,
    queueStatus,
    admits,
    ordersPerMinute,
    paidPerMinute,
    stockValues,
  ] = await Promise.all([
    ctx.redis.zcard(keys.queue(eventId)),
    ctx.redis.zcount(keys.active(eventId), now, "+inf"),
    readQueueStatus(ctx, eventId),
    admitsInWindow(ctx, eventId, minuteAgo),
    countInWindow(ctx, keys.orderStats(eventId), minuteAgo),
    countInWindow(ctx, keys.paidStats(eventId), minuteAgo),
    meta.stockKeys.length > 0 ? ctx.redis.mget(...meta.stockKeys) : Promise.resolve([]),
  ]);

  const categories = meta.categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    quota: category.quota,
    sold: category.sold,
    reserved: category.reserved,
    redisStock: Number(stockValues[index] ?? "0"),
  }));

  let totalSold = 0;
  let totalReserved = 0;

  for (const category of categories) {
    totalSold += category.sold;
    totalReserved += category.reserved;
  }

  return {
    eventId,
    queueStatus: queueStatus ?? "SCHEDULED",
    queueLength,
    activeUsers,
    admitPerSec: meta.admitPerSec,
    maxActive: meta.maxActive,
    observedAdmitPerSec: admits / 60,
    ordersPerMinute,
    paidPerMinute,
    totalSold,
    totalReserved,
    categories,
    timestamp: new Date(now).toISOString(),
  };
}

export interface QueueControl {
  admitPerSec?: number;
  maxActive?: number;
  action?: "pause" | "resume";
}

/** Mengubah laju admission / maks aktif (DB + Redis) dan pause/resume antrean. */
export async function controlQueue(
  ctx: CoreContext,
  eventId: string,
  control: QueueControl,
): Promise<QueueStatus | null> {
  const data: Prisma.EventUpdateInput = {};

  if (control.admitPerSec !== undefined) {
    data.admitPerSec = control.admitPerSec;
  }

  if (control.maxActive !== undefined) {
    data.maxActive = control.maxActive;
  }

  if (control.admitPerSec !== undefined || control.maxActive !== undefined) {
    await ctx.prisma.event.update({ where: { id: eventId }, data });
  }

  const meta = await loadEventMeta(ctx.prisma, eventId);

  if (meta === null) {
    return null;
  }

  await writeEventConfig(ctx, meta);

  const current = await readQueueStatus(ctx, eventId);

  if (control.action === "pause" && current === "OPEN") {
    await ctx.redis.set(keys.status(eventId), "PAUSED");

    return "PAUSED";
  }

  if (control.action === "resume" && current === "PAUSED") {
    await ctx.redis.set(keys.status(eventId), "OPEN");

    return "OPEN";
  }

  return current;
}

/** Membuat atau memperbarui event beserta kategorinya. Kuota tidak boleh diturunkan di bawah tiket terjual + ditahan. */
export async function upsertEvent(ctx: CoreContext, input: EventInput): Promise<string> {
  const preQueueAt = input.preQueueAt ?? new Date(input.saleOpensAt.getTime() - 30 * 60_000);

  const eventData = {
    name: input.name,
    venue: input.venue,
    description: input.description,
    posterUrl: input.posterUrl,
    startsAt: input.startsAt,
    saleOpensAt: input.saleOpensAt,
    preQueueAt,
    status: input.status,
    admitPerSec: input.admitPerSec,
    maxActive: input.maxActive,
    maxPerUser: input.maxPerUser,
  };

  const stockDeltas: { categoryId: string; delta: number }[] = [];

  const eventId = await ctx.prisma.$transaction(async (tx) => {
    const event =
      input.id === undefined
        ? await tx.event.create({ data: eventData })
        : await tx.event.update({ where: { id: input.id }, data: eventData });

    for (const [index, category] of input.categories.entries()) {
      if (category.id === undefined) {
        await tx.ticketCategory.create({
          data: {
            eventId: event.id,
            name: category.name,
            price: category.price,
            quota: category.quota,
            sortOrder: index,
          },
        });
        continue;
      }

      const current = await tx.ticketCategory.findFirstOrThrow({
        where: { id: category.id, eventId: event.id },
      });

      const quotaDelta = category.quota - current.quota;

      await tx.ticketCategory.update({
        where: { id: category.id },
        data: {
          name: category.name,
          price: category.price,
          quota: category.quota,
          sortOrder: index,
        },
      });

      if (quotaDelta !== 0) {
        stockDeltas.push({ categoryId: category.id, delta: quotaDelta });
      }
    }

    return event.id;
  });

  // Perubahan kuota diteruskan ke stok Redis sebagai delta (setelah commit) agar tidak menimpa reservasi berjalan.
  for (const { categoryId, delta } of stockDeltas) {
    await ctx.redis.incrby(keys.stock(eventId, categoryId), delta);
  }

  const meta = await loadEventMeta(ctx.prisma, eventId);

  if (meta !== null) {
    await syncEventToRedis(ctx, meta, new Date());
  }

  return eventId;
}

async function deleteByPattern(ctx: CoreContext, pattern: string): Promise<void> {
  let cursor = "0";

  do {
    const [next, found] = await ctx.redis.scan(cursor, "MATCH", pattern, "COUNT", 1000);

    cursor = next;

    if (found.length > 0) {
      await ctx.redis.unlink(...found);
    }
  } while (cursor !== "0");
}

/**
 * KHUSUS LOAD TEST: menghapus semua order event, mengosongkan state Redis,
 * dan menjadwalkan ulang ruang tunggu/penjualan relatif terhadap sekarang.
 */
export async function resetEventForLoadTest(
  ctx: CoreContext,
  eventId: string,
  schedule: {
    preQueueInSec: number;
    saleOpensInSec: number;
    admitPerSec?: number;
    maxActive?: number;
  },
): Promise<void> {
  const now = Date.now();

  const eventData: Prisma.EventUpdateInput = {
    status: "SCHEDULED",
    preQueueAt: new Date(now + schedule.preQueueInSec * 1000),
    saleOpensAt: new Date(now + schedule.saleOpensInSec * 1000),
  };

  if (schedule.admitPerSec !== undefined) {
    eventData.admitPerSec = schedule.admitPerSec;
  }

  if (schedule.maxActive !== undefined) {
    eventData.maxActive = schedule.maxActive;
  }

  await ctx.prisma.$transaction([
    ctx.prisma.order.deleteMany({ where: { eventId } }),
    ctx.prisma.ticketCategory.updateMany({ where: { eventId }, data: { sold: 0, reserved: 0 } }),
    ctx.prisma.event.update({ where: { id: eventId }, data: eventData }),
  ]);

  await Promise.all([deleteByPattern(ctx, `*:${eventId}`), deleteByPattern(ctx, `*:${eventId}:*`)]);

  const meta = await loadEventMeta(ctx.prisma, eventId);

  if (meta === null) {
    return;
  }

  // Tulis ulang stok dan status secara eksplisit (bukan SET NX / aturan status terminal),
  // karena worker bisa sempat menulis nilai dari keadaan lama selama key sedang dihapus.
  const write = ctx.redis.multi();

  for (const category of meta.categories) {
    write.set(keys.stock(eventId, category.id), category.quota);
  }

  write.set(keys.status(eventId), scheduledQueueStatus(meta, new Date()));
  await write.exec();
  await syncEventToRedis(ctx, meta, new Date());
}

export async function suspiciousSignupIps(
  ctx: CoreContext,
  minAccounts: number,
): Promise<{ ip: string; accounts: number }[]> {
  const groups = await ctx.prisma.user.groupBy({
    by: ["signupIp"],
    where: { signupIp: { not: null } },
    _count: { _all: true },
    having: { signupIp: { _count: { gte: minAccounts } } },
    orderBy: { _count: { signupIp: "desc" } },
    take: 100,
  });

  return groups.flatMap((group) =>
    group.signupIp === null ? [] : [{ ip: group.signupIp, accounts: group._count._all }],
  );
}
