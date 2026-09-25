import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@antretix/db";
import { AppError, checkPerUserLimit, keys, type OrderView } from "@antretix/shared";
import { z } from "zod";
import { newOrderCode } from "./codes";
import type { CoreContext } from "./context";
import type { EventMeta } from "./events";

export interface CreateOrderRequest {
  meta: EventMeta;
  userId: string;
  categoryId: string;
  qty: number;
  idempotencyKey: string;
}

export interface CreateOrderResult {
  created: boolean;
  order: OrderView;
}

const orderInclude = {
  event: { select: { name: true } },
  items: { include: { category: { select: { name: true } } } },
  tickets: { orderBy: { code: "asc" } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function toOrderView(order: OrderWithRelations): OrderView {
  return {
    id: order.id,
    code: order.code,
    eventId: order.eventId,
    eventName: order.event.name,
    status: order.status,
    totalPrice: order.totalPrice,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt === null ? null : order.paidAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    serverTime: new Date().toISOString(),
    items: order.items.map((item) => ({
      categoryId: item.categoryId,
      categoryName: item.category.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    tickets: order.tickets.map((ticket) => ({
      id: ticket.id,
      code: ticket.code,
      categoryName: ticket.categoryName,
      checkedIn: ticket.checkedIn,
    })),
  };
}

export async function getOrderView(
  prisma: PrismaClient,
  orderId: string,
): Promise<(OrderView & { userId: string }) | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });

  if (order === null) {
    return null;
  }

  return { ...toOrderView(order), userId: order.userId };
}

export async function listUserOrders(prisma: PrismaClient, userId: string): Promise<OrderView[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return orders.map(toOrderView);
}

function scopedIdempotencyKey(userId: string, key: string): string {
  return `${userId}:${key}`;
}

async function findByIdempotencyKey(
  prisma: PrismaClient,
  userId: string,
  key: string,
): Promise<OrderView | null> {
  const order = await prisma.order.findUnique({
    where: { idempotencyKey: scopedIdempotencyKey(userId, key) },
    include: orderInclude,
  });

  return order === null ? null : toOrderView(order);
}

const reserveResult = z.array(
  z.object({ result: z.enum(["OK", "LIMIT_EXCEEDED", "OUT_OF_STOCK"]) }),
);

/**
 * Lapis 2: fungsi PostgreSQL antretix_reserve_order (lihat migrasi order_functions). Dalam satu statement:
 * kunci advisory per (akun, event) untuk cek batas per akun, UPDATE bersyarat yang mencegah oversell,
 * harga dikunci, lalu order + item disisipkan. Kunci baris kategori hanya dipegang di sisi database.
 */
async function reserveInDatabase(
  ctx: CoreContext,
  request: CreateOrderRequest,
  categoryName: string,
): Promise<OrderWithRelations> {
  const { meta, userId, categoryId, qty, idempotencyKey } = request;
  const orderId = randomUUID();
  const expiresAt = new Date(Date.now() + ctx.settings.holdTtlMs);

  const rows = reserveResult.parse(
    await ctx.prisma.$queryRaw`
      SELECT antretix_reserve_order(
        ${orderId}, ${newOrderCode()}, ${userId}, ${meta.id}, ${categoryId},
        ${qty}::int, ${meta.maxPerUser}::int, ${scopedIdempotencyKey(userId, idempotencyKey)},
        ${expiresAt}::timestamptz, ${randomUUID()}
      ) AS result`,
  );

  const result = rows[0]?.result;

  if (result === "LIMIT_EXCEEDED") {
    throw new AppError(
      "LIMIT_EXCEEDED",
      `Maksimal ${meta.maxPerUser} tiket per akun untuk event ini`,
    );
  }

  if (result !== "OK") {
    throw new AppError("OUT_OF_STOCK", `Tiket ${categoryName} habis atau tidak cukup`);
  }

  return ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

/**
 * KHUSUS LOAD TEST (skenario 1, pembanding): checkout "naif" tanpa antrean dan tanpa penyaring Redis.
 * Setiap request langsung membuka transaksi di PostgreSQL, persis seperti sistem yang tidak punya ruang tunggu.
 */
export async function createOrderWithoutQueue(
  ctx: CoreContext,
  request: CreateOrderRequest,
): Promise<OrderView> {
  const category = request.meta.categories.find((candidate) => candidate.id === request.categoryId);

  if (category === undefined) {
    throw new AppError("NOT_FOUND", "Kategori tiket tidak ditemukan");
  }

  return toOrderView(await reserveInDatabase(ctx, request, category.name));
}

/**
 * Membuat order PENDING dengan dua lapis anti-oversell:
 *   1. reserve.lua di Redis: cek stok + batas per akun secara atomik, menolak lebih awal dan cepat.
 *   2. UPDATE bersyarat di PostgreSQL (plus CHECK constraint): penjaga terakhir yang tidak bisa dilewati.
 * Bila lapis 2 gagal, stok Redis dikembalikan. Idempotency key membuat retry aman.
 */
export async function createOrder(
  ctx: CoreContext,
  request: CreateOrderRequest,
): Promise<CreateOrderResult> {
  const { meta, userId, categoryId, qty, idempotencyKey } = request;
  const existing = await findByIdempotencyKey(ctx.prisma, userId, idempotencyKey);

  if (existing !== null) {
    return { created: false, order: existing };
  }

  const category = meta.categories.find((candidate) => candidate.id === categoryId);

  if (category === undefined) {
    throw new AppError("NOT_FOUND", "Kategori tiket tidak ditemukan");
  }

  if (checkPerUserLimit(0, qty, meta.maxPerUser) === "LIMIT_EXCEEDED") {
    throw new AppError("LIMIT_EXCEEDED", `Maksimal ${meta.maxPerUser} tiket per akun`);
  }

  const reserveResult = await ctx.lua.reserve(meta.id, categoryId, userId, qty, meta.maxPerUser);

  if (reserveResult === -1) {
    throw new AppError("OUT_OF_STOCK", `Tiket ${category.name} habis atau tidak cukup`);
  }

  if (reserveResult === -2) {
    throw new AppError(
      "LIMIT_EXCEEDED",
      `Maksimal ${meta.maxPerUser} tiket per akun untuk event ini`,
    );
  }

  if (reserveResult === -3) {
    throw new AppError("QUEUE_NOT_OPEN", "Stok tiket belum siap, coba beberapa detik lagi");
  }

  let order: OrderWithRelations;

  try {
    order = await reserveInDatabase(ctx, request, category.name);
  } catch (error) {
    await ctx.lua.release(meta.id, categoryId, userId, qty);

    // Request kembar dengan idempotency key sama bisa kalah balapan di unique index: kembalikan order pemenangnya.
    if (!(error instanceof AppError)) {
      const duplicate = await findByIdempotencyKey(ctx.prisma, userId, idempotencyKey);

      if (duplicate !== null) {
        return { created: false, order: duplicate };
      }
    }

    throw error;
  }

  await recordStat(ctx, keys.orderStats(meta.id), order.id);

  return { created: true, order: toOrderView(order) };
}

export async function recordStat(ctx: CoreContext, key: string, member: string): Promise<void> {
  const now = Date.now();

  await ctx.redis
    .multi()
    .zadd(key, now, member)
    .zremrangebyscore(key, "-inf", now - 5 * 60_000)
    .exec();
}

export type ReleaseReason = "EXPIRED" | "CANCELLED";

const releasedRows = z.array(
  z.object({
    event_id: z.string(),
    user_id: z.string(),
    category_id: z.string(),
    qty: z.coerce.number().int(),
  }),
);

/**
 * Mengubah order PENDING menjadi EXPIRED/CANCELLED dan mengembalikan stok (fungsi antretix_release_order).
 * Idempoten: transisi status bersyarat (WHERE status = PENDING) hanya bisa dimenangkan satu kali,
 * dan stok Redis hanya dikembalikan oleh pemenangnya.
 */
export async function releaseOrder(
  ctx: CoreContext,
  orderId: string,
  reason: ReleaseReason,
): Promise<boolean> {
  const released = releasedRows.parse(
    await ctx.prisma.$queryRaw`
      SELECT event_id, user_id, category_id, qty
      FROM antretix_release_order(${orderId}, ${reason}, ${reason === "EXPIRED"})`,
  );

  // Baris kosong berarti order sudah bukan PENDING (diproses pemanggil lain): stok tidak dikembalikan dua kali.
  for (const item of released) {
    await ctx.lua.release(item.event_id, item.category_id, item.user_id, item.qty);
  }

  return released.length > 0;
}

/** Job expiry: memproses order PENDING yang sudah lewat masa hold. Mengembalikan jumlah order yang dirilis. */
export async function expireDueOrders(ctx: CoreContext, batchSize: number): Promise<number> {
  const due = await ctx.prisma.order.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
  });

  let released = 0;

  for (const order of due) {
    if (await releaseOrder(ctx, order.id, "EXPIRED")) {
      released += 1;
    }
  }

  return released;
}
