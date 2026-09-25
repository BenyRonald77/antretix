import { randomUUID } from "node:crypto";
import { loadEventMeta, type CoreContext, type EventMeta } from "@antretix/core";
import { createPrisma } from "@antretix/db";
import { LuaScripts } from "@antretix/lua";
import { keys } from "@antretix/shared";
import { Redis } from "ioredis";
import { inject } from "vitest";

export function createTestContext(): CoreContext {
  const prisma = createPrisma(inject("databaseUrl"));
  const redis = new Redis(inject("redisUrl"), { maxRetriesPerRequest: 3 });

  return {
    prisma,
    redis,
    lua: new LuaScripts(redis),
    settings: { holdTtlMs: 10 * 60_000, sessionTtlMs: 10 * 60_000, heartbeatTimeoutMs: 2 * 60_000 },
  };
}

export async function closeTestContext(ctx: CoreContext): Promise<void> {
  await ctx.prisma.$disconnect();
  ctx.redis.disconnect();
}

export interface SeededEvent {
  meta: EventMeta;
  categoryId: string;
}

/** Membuat event baru (id unik per test) dengan satu kategori berkuota tertentu, plus stok Redis-nya. */
export async function seedEvent(
  ctx: CoreContext,
  quota: number,
  maxPerUser = 4,
): Promise<SeededEvent> {
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const categoryId = `${eventId}-cat`;
  const now = Date.now();

  await ctx.prisma.event.create({
    data: {
      id: eventId,
      name: "Konser Uji",
      venue: "Venue Uji",
      startsAt: new Date(now + 30 * 24 * 3600_000),
      saleOpensAt: new Date(now - 1000),
      preQueueAt: new Date(now - 60_000),
      status: "ON_SALE",
      maxPerUser,
      categories: { create: { id: categoryId, name: "Festival", price: 100_000, quota } },
    },
  });

  await ctx.redis.set(keys.stock(eventId, categoryId), quota);
  await ctx.redis.set(keys.status(eventId), "OPEN");

  const meta = await loadEventMeta(ctx.prisma, eventId);

  if (meta === null) {
    throw new Error("event uji gagal dibuat");
  }

  return { meta, categoryId };
}

export async function seedUsers(ctx: CoreContext, count: number): Promise<string[]> {
  const prefix = randomUUID().slice(0, 8);

  const data = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-u${index}`,
    email: `${prefix}-u${index}@uji.dev`,
    name: `Uji ${index}`,
  }));

  await ctx.prisma.user.createMany({ data });

  return data.map((user) => user.id);
}
