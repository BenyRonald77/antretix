import { randomUUID } from "node:crypto";
import { getQueueState, type CoreContext, type EventMeta } from "@antretix/core";
import { keys } from "@antretix/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestContext, createTestContext, seedEvent } from "./helpers";

let ctx: CoreContext;

const sign = () => "signed-token";

beforeAll(() => {
  ctx = createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

async function freshEvent(status: string): Promise<EventMeta> {
  const { meta } = await seedEvent(ctx, 1000);

  await ctx.redis.set(keys.status(meta.id), status);
  await ctx.redis.hset(keys.config(meta.id), { admitPerSec: 50, maxActive: 500, maxPerUser: 4 });

  return meta;
}

describe("join.lua", () => {
  it("join ulang dengan akun sama tidak mengubah posisi", async () => {
    const meta = await freshEvent("OPEN");
    const now = Date.now();

    await ctx.lua.join(meta.id, "a", now, Math.random());
    await ctx.lua.join(meta.id, "b", now + 1, Math.random());

    const before = await ctx.lua.join(meta.id, "a", now + 10_000, Math.random());

    expect(before.rank).toBe(0);
    expect(before.added).toBe(false);
    expect(await ctx.redis.zcard(keys.queue(meta.id))).toBe(2);
  });

  it("peserta pre-queue selalu di depan peserta setelah jam buka, dan setelahnya FIFO", async () => {
    const meta = await freshEvent("PREQUEUE");
    const now = Date.now();

    for (const user of ["p1", "p2", "p3"]) {
      const result = await ctx.lua.join(meta.id, user, now, Math.random());

      expect(result.code).toBe("PREQUEUE");
    }

    await ctx.redis.set(keys.status(meta.id), "OPEN");
    await ctx.lua.join(meta.id, "late-1", now + 5000, Math.random());
    await ctx.lua.join(meta.id, "late-2", now + 6000, Math.random());

    const order = await ctx.redis.zrange(keys.queue(meta.id), 0, -1);

    expect(new Set(order.slice(0, 3))).toEqual(new Set(["p1", "p2", "p3"]));
    expect(order.slice(3)).toEqual(["late-1", "late-2"]);
  });

  it("antrean menolak join saat SOLD_OUT dan saat belum dibuka", async () => {
    const soldOut = await freshEvent("SOLD_OUT");
    const scheduled = await freshEvent("SCHEDULED");

    expect((await ctx.lua.join(soldOut.id, "x", Date.now(), 0.5)).code).toBe("SOLD_OUT");
    expect((await ctx.lua.join(scheduled.id, "x", Date.now(), 0.5)).code).toBe("NOT_OPEN");
  });
});

describe("admit.lua dan status", () => {
  it("admission menghormati laju, batas aktif, dan urutan antrean", async () => {
    const meta = await freshEvent("OPEN");
    const now = Date.now();

    for (let index = 0; index < 10; index += 1) {
      await ctx.lua.join(meta.id, `u${index}`, now + index, 0.5);
    }

    const first = await ctx.lua.admit(meta, now, {
      admitPerSec: 3,
      maxActive: 5,
      sessionTtlMs: 600_000,
    });

    const second = await ctx.lua.admit(meta, now + 1000, {
      admitPerSec: 3,
      maxActive: 5,
      sessionTtlMs: 600_000,
    });

    expect(first.admitted).toBe(3);
    expect(second.admitted).toBe(2);
    expect(second.active).toBe(5);
    expect(await ctx.redis.zrange(keys.active(meta.id), 0, -1)).toEqual([
      "u0",
      "u1",
      "u2",
      "u3",
      "u4",
    ]);

    const admittedState = await getQueueState(ctx, meta, "u0", sign);
    const waitingState = await getQueueState(ctx, meta, "u7", sign);

    expect(admittedState.state).toBe("ADMITTED");
    expect(waitingState).toMatchObject({ state: "WAITING", position: 3, ahead: 2, total: 5 });
  });

  it("posisi tidak dibocorkan selama PREQUEUE", async () => {
    const meta = await freshEvent("PREQUEUE");

    await ctx.lua.join(meta.id, "early", Date.now(), 0.3);

    expect((await getQueueState(ctx, meta, "early", sign)).state).toBe("WAITING_ROOM");
  });

  it("sesi aktif yang kedaluwarsa dibersihkan dan kursinya diisi orang berikutnya", async () => {
    const meta = await freshEvent("OPEN");
    const now = Date.now();

    await ctx.lua.join(meta.id, "first", now, 0.5);
    await ctx.lua.join(meta.id, "second", now + 1, 0.5);
    await ctx.lua.admit(meta, now, { admitPerSec: 10, maxActive: 1, sessionTtlMs: 1000 });

    const later = await ctx.lua.admit(meta, now + 2000, {
      admitPerSec: 10,
      maxActive: 1,
      sessionTtlMs: 1000,
    });

    expect(later.admitted).toBe(1);
    expect(await ctx.redis.zrange(keys.active(meta.id), 0, -1)).toEqual(["second"]);
  });

  it("tidak ada admission saat antrean dijeda atau stok habis", async () => {
    const paused = await freshEvent("PAUSED");
    const empty = await freshEvent("OPEN");

    await ctx.lua.join(paused.id, "p", Date.now(), 0.5);
    await ctx.lua.join(empty.id, "e", Date.now(), 0.5);
    await ctx.redis.set(keys.stock(empty.id, empty.categories[0]?.id ?? ""), 0);

    const limits = { admitPerSec: 10, maxActive: 10, sessionTtlMs: 60_000 };

    expect((await ctx.lua.admit(paused, Date.now(), limits)).admitted).toBe(0);
    expect((await ctx.lua.admit(empty, Date.now(), limits)).reason).toBe("NO_STOCK");
  });
});

describe("heartbeat", () => {
  it("anggota tanpa heartbeat lebih dari batas waktu dikeluarkan", async () => {
    const meta = await freshEvent("OPEN");
    const now = Date.now();

    await ctx.lua.join(meta.id, "gone", now - 5 * 60_000, 0.5);
    await ctx.lua.join(meta.id, "alive", now, 0.5);

    const removed = await ctx.lua.cleanup(meta.id, now - 120_000, 100);

    expect(removed).toBe(1);
    expect(await ctx.redis.zrange(keys.queue(meta.id), 0, -1)).toEqual(["alive"]);
  });
});

describe("rate limiter", () => {
  it("sliding window menolak request melewati batas dan memberi waktu tunggu", async () => {
    const rule = { key: keys.rateLimit("test", randomUUID()), windowMs: 60_000, limit: 5 };
    const now = Date.now();
    const results: number[] = [];

    for (let index = 0; index < 7; index += 1) {
      const result = await ctx.lua.rateLimit([rule], now + index, `m${index}`);

      results.push(result.blockedIndex === -1 ? 0 : result.retryAfterMs);
    }

    expect(results.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(results[5]).toBeGreaterThan(59_000);
    expect((await ctx.lua.rateLimit([rule], now + 60_001, "later")).blockedIndex).toBe(-1);
  });

  it("beberapa aturan dicek sekaligus; request yang ditolak tidak menghabiskan kuota aturan lain", async () => {
    const wide = { key: keys.rateLimit("ip", randomUUID()), windowMs: 60_000, limit: 100 };
    const narrow = { key: keys.rateLimit("join", randomUUID()), windowMs: 60_000, limit: 2 };
    const now = Date.now();
    const blocked: number[] = [];

    for (let index = 0; index < 4; index += 1) {
      blocked.push(
        (await ctx.lua.rateLimit([wide, narrow], now + index, `m${index}`)).blockedIndex,
      );
    }

    // Aturan ke-2 (indeks 1) memblokir request ke-3 dan ke-4.
    expect(blocked).toEqual([-1, -1, 1, 1]);
    // Aturan lebar hanya mencatat 2 request yang lolos.
    expect(await ctx.redis.zcard(wide.key)).toBe(2);
  });
});
