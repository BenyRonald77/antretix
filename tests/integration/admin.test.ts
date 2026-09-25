import {
  controlQueue,
  createOrder,
  getAdminMetrics,
  loadEventMeta,
  reconcileStock,
  resetEventForLoadTest,
  suspiciousSignupIps,
  syncEventToRedis,
  upsertEvent,
  type CoreContext,
} from "@antretix/core";
import { eventInputSchema, keys } from "@antretix/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestContext, createTestContext, seedEvent, seedUsers } from "./helpers";

let ctx: CoreContext;

beforeAll(() => {
  ctx = createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

describe("rekonsiliasi stok", () => {
  it("selisih sesaat hanya dicatat; selisih yang menetap 3 putaran dikoreksi", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 100);
    const stockKey = keys.stock(meta.id, categoryId);

    expect((await reconcileStock(ctx, meta.id))[0]?.diff).toBe(0);

    // Stok Redis "bocor" 5 tiket (mis. kompensasi gagal saat Redis sempat putus).
    await ctx.redis.set(stockKey, 95);

    const first = await reconcileStock(ctx, meta.id);
    const second = await reconcileStock(ctx, meta.id);

    expect(first[0]).toMatchObject({ diff: -5, healed: false });
    expect(second[0]).toMatchObject({ diff: -5, healed: false });
    expect(await ctx.redis.get(stockKey)).toBe("95");

    const third = await reconcileStock(ctx, meta.id);

    expect(third[0]).toMatchObject({ diff: -5, healed: true });
    expect(await ctx.redis.get(stockKey)).toBe("100");
  });

  it("selisih yang berubah-ubah (reservasi sedang berjalan) tidak dikoreksi", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 100);
    const stockKey = keys.stock(meta.id, categoryId);

    for (const value of [99, 98, 97]) {
      await ctx.redis.set(stockKey, value);

      const rows = await reconcileStock(ctx, meta.id);

      expect(rows[0]?.healed).toBe(false);
    }

    expect(await ctx.redis.get(stockKey)).toBe("97");
  });
});

describe("kontrol antrean admin", () => {
  it("pause/resume hanya berlaku pada status yang sesuai, dan laju baru tertulis ke Redis", async () => {
    const { meta } = await seedEvent(ctx, 10);

    expect(await controlQueue(ctx, meta.id, { action: "pause" })).toBe("PAUSED");
    expect(await controlQueue(ctx, meta.id, { action: "pause" })).toBe("PAUSED");
    expect(
      await controlQueue(ctx, meta.id, { action: "resume", admitPerSec: 120, maxActive: 900 }),
    ).toBe("OPEN");
    expect(await ctx.redis.hgetall(keys.config(meta.id))).toMatchObject({
      admitPerSec: "120",
      maxActive: "900",
    });
    expect(await controlQueue(ctx, "tidak-ada", {})).toBeNull();
  });

  it("metrik admin menggabungkan antrean Redis dan kuota PostgreSQL", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 10);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    await ctx.lua.join(meta.id, "antre-1", Date.now(), 0.5);
    await createOrder(ctx, { meta, userId, categoryId, qty: 2, idempotencyKey: "metrics-1" });

    const metrics = await getAdminMetrics(ctx, meta.id);

    expect(metrics).toMatchObject({
      queueLength: 1,
      ordersPerMinute: 1,
      totalReserved: 2,
      totalSold: 0,
    });
    expect(metrics?.categories[0]).toMatchObject({ quota: 10, reserved: 2, redisStock: 8 });
    expect(await getAdminMetrics(ctx, "tidak-ada")).toBeNull();
  });
});

describe("pengelolaan event", () => {
  it("membuat event baru lalu menaikkan kuota diteruskan ke stok Redis sebagai delta", async () => {
    const saleOpensAt = new Date(Date.now() + 3600_000);

    const input = eventInputSchema.parse({
      name: "Event Admin",
      venue: "Venue",
      startsAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      saleOpensAt: saleOpensAt.toISOString(),
      categories: [{ name: "Festival", price: 500_000, quota: 100 }],
    });

    const eventId = await upsertEvent(ctx, input);
    const created = await loadEventMeta(ctx.prisma, eventId);
    const category = created?.categories[0];

    if (created === null || category === undefined) {
      throw new Error("event tidak tersimpan");
    }

    // preQueueAt default: 30 menit sebelum penjualan.
    expect(created.preQueueAt.getTime()).toBe(saleOpensAt.getTime() - 30 * 60_000);
    expect(await ctx.redis.get(keys.stock(eventId, category.id))).toBe("100");

    await upsertEvent(ctx, {
      ...input,
      id: eventId,
      categories: [{ id: category.id, name: "Festival", price: 500_000, quota: 150 }],
    });

    expect(await ctx.redis.get(keys.stock(eventId, category.id))).toBe("150");
  });

  it("reset load test menghapus order dan state Redis lalu menjadwalkan ulang", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 10);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    await createOrder(ctx, { meta, userId, categoryId, qty: 2, idempotencyKey: "reset-1" });
    await ctx.lua.join(meta.id, "antre", Date.now(), 0.5);
    await resetEventForLoadTest(ctx, meta.id, {
      preQueueInSec: 0,
      saleOpensInSec: 60,
      admitPerSec: 7,
    });

    const fresh = await loadEventMeta(ctx.prisma, meta.id);

    expect(await ctx.prisma.order.count({ where: { eventId: meta.id } })).toBe(0);
    expect(fresh).toMatchObject({ admitPerSec: 7, status: "SCHEDULED" });
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("10");
    expect(await ctx.redis.zcard(keys.queue(meta.id))).toBe(0);
    expect(await ctx.redis.get(keys.status(meta.id))).toBe("PREQUEUE");
  });

  it("sinkronisasi tidak menimpa stok Redis yang sedang berjalan", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 10);

    await ctx.redis.set(keys.stock(meta.id, categoryId), 3);
    await syncEventToRedis(ctx, meta, new Date());

    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("3");
  });
});

describe("anti-bot", () => {
  it("IP yang membuat banyak akun muncul di daftar tinjauan admin", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;

    await ctx.prisma.user.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        email: `bot-${ip}-${index}@uji.dev`,
        name: "bot",
        signupIp: ip,
      })),
    });

    const ips = await suspiciousSignupIps(ctx, 3);

    expect(ips).toContainEqual({ ip, accounts: 4 });
  });
});
