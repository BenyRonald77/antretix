import { randomUUID } from "node:crypto";
import { createOrder, expireDueOrders, releaseOrder, type CoreContext } from "@antretix/core";
import { AppError, keys } from "@antretix/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestContext, createTestContext, seedEvent, seedUsers } from "./helpers";

let ctx: CoreContext;

beforeAll(() => {
  ctx = createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

describe("reserve.lua (lapis 1)", () => {
  it("1.000 reservasi serentak pada stok 100 menghasilkan tepat 100 sukses", async () => {
    const eventId = `lua-${randomUUID().slice(0, 8)}`;
    const categoryId = "cat";

    await ctx.redis.set(keys.stock(eventId, categoryId), 100);

    const results = await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        ctx.lua.reserve(eventId, categoryId, `user-${index}`, 1, 4),
      ),
    );

    let success = 0;
    let outOfStock = 0;

    for (const result of results) {
      if (result >= 0) {
        success += 1;
      } else if (result === -1) {
        outOfStock += 1;
      }
    }

    expect(success).toBe(100);
    expect(outOfStock).toBe(900);
    expect(await ctx.redis.get(keys.stock(eventId, categoryId))).toBe("0");
  });

  it("batas per akun berlaku lintas panggilan serentak", async () => {
    const eventId = `lua-${randomUUID().slice(0, 8)}`;

    await ctx.redis.set(keys.stock(eventId, "cat"), 1000);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => ctx.lua.reserve(eventId, "cat", "same-user", 1, 4)),
    );

    let success = 0;

    for (const result of results) {
      if (result >= 0) {
        success += 1;
      }
    }

    expect(success).toBe(4);
    expect(results.filter((result) => result === -2)).toHaveLength(16);
    expect(await ctx.redis.get(keys.bought(eventId, "same-user"))).toBe("4");
  });
});

describe("createOrder (Redis + PostgreSQL)", () => {
  it("300 pembeli berebut 50 tiket: tepat 50 order, tidak ada oversell di DB", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 50);
    const users = await seedUsers(ctx, 300);

    const outcomes = await Promise.allSettled(
      users.map((userId) =>
        createOrder(ctx, { meta, userId, categoryId, qty: 1, idempotencyKey: `k-${userId}` }),
      ),
    );

    let created = 0;

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        created += 1;
      } else {
        expect(outcome.reason).toBeInstanceOf(AppError);
        expect(outcome.reason.code).toBe("OUT_OF_STOCK");
      }
    }

    const category = await ctx.prisma.ticketCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    expect(created).toBe(50);
    expect(category.sold + category.reserved).toBe(50);
    expect(await ctx.prisma.order.count({ where: { eventId: meta.id } })).toBe(50);
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("0");
  });

  it("PostgreSQL tetap menolak oversell walau stok Redis salah (lapis 2) dan stok Redis dikompensasi", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 20);
    const users = await seedUsers(ctx, 60);

    // Simulasikan Redis yang tidak sinkron: stok terlihat jauh lebih besar dari kuota sebenarnya.
    await ctx.redis.set(keys.stock(meta.id, categoryId), 1000);

    const outcomes = await Promise.allSettled(
      users.map((userId) =>
        createOrder(ctx, { meta, userId, categoryId, qty: 1, idempotencyKey: `k-${userId}` }),
      ),
    );

    const created = outcomes.filter((outcome) => outcome.status === "fulfilled").length;

    const category = await ctx.prisma.ticketCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    expect(created).toBe(20);
    expect(category.reserved).toBe(20);
    // 40 reservasi Redis yang ditolak DB dikembalikan: 1000 - 20.
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("980");
  });

  it("idempotency key yang sama tidak membuat order kedua", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 10);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    const request = { meta, userId, categoryId, qty: 2, idempotencyKey: "same-key-123" };

    const results = await Promise.allSettled([
      createOrder(ctx, request),
      createOrder(ctx, request),
      createOrder(ctx, request),
    ]);

    const orderIds = new Set(
      results.flatMap((result) => (result.status === "fulfilled" ? [result.value.order.id] : [])),
    );

    expect(orderIds.size).toBe(1);
    expect(await ctx.prisma.order.count({ where: { eventId: meta.id } })).toBe(1);
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("8");
  });

  it("batas 4 tiket per akun juga dijaga PostgreSQL lintas order", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 100);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    await createOrder(ctx, { meta, userId, categoryId, qty: 3, idempotencyKey: "first-order" });
    // Hapus penghitung Redis agar hanya lapis PostgreSQL yang diuji.
    await ctx.redis.del(keys.bought(meta.id, userId));

    await expect(
      createOrder(ctx, { meta, userId, categoryId, qty: 2, idempotencyKey: "second-order" }),
    ).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
  });
});

describe("expiry", () => {
  it("order kedaluwarsa mengembalikan stok tepat satu kali meski job berjalan dua kali serentak", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 10);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    const { order } = await createOrder(ctx, {
      meta,
      userId,
      categoryId,
      qty: 3,
      idempotencyKey: "exp-1",
    });

    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const [first, second] = await Promise.all([
      expireDueOrders(ctx, 100),
      expireDueOrders(ctx, 100),
    ]);

    const again = await releaseOrder(ctx, order.id, "EXPIRED");

    const category = await ctx.prisma.ticketCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    expect((first ?? 0) + (second ?? 0)).toBe(1);
    expect(again).toBe(false);
    expect(category.reserved).toBe(0);
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("10");
    expect(await ctx.redis.get(keys.bought(meta.id, userId))).toBeNull();
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "EXPIRED",
    );
  });

  it("order yang belum lewat masa hold tidak dirilis job expiry", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 5);
    const [userId] = await seedUsers(ctx, 1);

    if (userId === undefined) {
      throw new Error("user uji tidak ada");
    }

    const { order } = await createOrder(ctx, {
      meta,
      userId,
      categoryId,
      qty: 1,
      idempotencyKey: "exp-2",
    });

    expect(await releaseOrder(ctx, order.id, "EXPIRED")).toBe(false);
    expect(await ctx.redis.get(keys.stock(meta.id, categoryId))).toBe("4");
  });
});
