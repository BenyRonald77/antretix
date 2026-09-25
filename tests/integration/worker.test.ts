import type { CoreContext } from "@antretix/core";
import { keys } from "@antretix/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_INTERVALS, Worker } from "../../apps/worker/src/jobs";
import { createWorkerMetrics } from "../../apps/worker/src/metrics";
import { closeTestContext, createTestContext, seedEvent } from "./helpers";

let ctx: CoreContext;

let worker: Worker;

beforeAll(async () => {
  ctx = createTestContext();
  worker = new Worker(
    ctx,
    createWorkerMetrics("test"),
    `test-${Date.now()}`,
    DEFAULT_INTERVALS,
    () => undefined,
  );
});

afterAll(async () => {
  worker.stop();
  await closeTestContext(ctx);
});

describe("worker: penutupan antrean saat habis", () => {
  it("stok Redis kosong sesaat tidak menutup antrean selama PostgreSQL masih punya kuota", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 2);

    await worker.syncEvents();
    // Simulasikan key stok yang sedang dibuat ulang: Redis membaca 0, padahal belum ada tiket terjual.
    await ctx.redis.set(keys.stock(meta.id, categoryId), 0);
    await worker.admissionTick();

    expect(await ctx.redis.get(keys.status(meta.id))).toBe("OPEN");
  });

  it("antrean ditutup SOLD_OUT bila seluruh kuota terjual menurut PostgreSQL", async () => {
    const { meta, categoryId } = await seedEvent(ctx, 2);

    await worker.syncEvents();
    await ctx.prisma.ticketCategory.update({ where: { id: categoryId }, data: { sold: 2 } });
    await ctx.redis.set(keys.stock(meta.id, categoryId), 0);
    await worker.admissionTick();

    expect(await ctx.redis.get(keys.status(meta.id))).toBe("SOLD_OUT");
    expect((await ctx.prisma.event.findUniqueOrThrow({ where: { id: meta.id } })).status).toBe(
      "SOLD_OUT",
    );
  });

  it("worker memasukkan antrean ke sesi aktif sesuai laju yang dikonfigurasi", async () => {
    const { meta } = await seedEvent(ctx, 100);

    await worker.syncEvents();
    await ctx.redis.hset(keys.config(meta.id), { admitPerSec: 2 });

    for (const user of ["a", "b", "c"]) {
      await ctx.lua.join(meta.id, user, Date.now(), 0.5);
    }

    await worker.admissionTick();

    expect(await ctx.redis.zcard(keys.active(meta.id))).toBe(2);
    expect(await ctx.redis.zcard(keys.queue(meta.id))).toBe(1);
  });
});
