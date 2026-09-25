import type { EventStatus, PrismaClient } from "@antretix/db";
import { isQueueStatus, keys, type QueueStatus } from "@antretix/shared";
import type { CoreContext } from "./context";

export interface CategoryMeta {
  id: string;
  name: string;
  price: number;
  quota: number;
  sold: number;
  reserved: number;
  sortOrder: number;
}

/** Data event yang sering dibaca di hot path; di-cache sebentar di memori setiap instance. */
export interface EventMeta {
  id: string;
  name: string;
  venue: string;
  description: string;
  posterUrl: string;
  startsAt: Date;
  saleOpensAt: Date;
  preQueueAt: Date;
  status: EventStatus;
  admitPerSec: number;
  maxActive: number;
  maxPerUser: number;
  categories: CategoryMeta[];
  stockKeys: string[];
}

export async function loadEventMeta(
  prisma: PrismaClient,
  eventId: string,
): Promise<EventMeta | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { categories: { orderBy: { sortOrder: "asc" } } },
  });

  if (event === null) {
    return null;
  }

  const categories = event.categories.map((category) => ({
    id: category.id,
    name: category.name,
    price: category.price,
    quota: category.quota,
    sold: category.sold,
    reserved: category.reserved,
    sortOrder: category.sortOrder,
  }));

  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    description: event.description,
    posterUrl: event.posterUrl,
    startsAt: event.startsAt,
    saleOpensAt: event.saleOpensAt,
    preQueueAt: event.preQueueAt,
    status: event.status,
    admitPerSec: event.admitPerSec,
    maxActive: event.maxActive,
    maxPerUser: event.maxPerUser,
    categories,
    stockKeys: categories.map((category) => keys.stock(event.id, category.id)),
  };
}

interface CacheEntry {
  loadedAt: number;
  value: Promise<EventMeta | null>;
}

/**
 * Cache in-memory dengan TTL pendek. Request serentak untuk event yang sama
 * berbagi satu query (promise yang sama), sehingga lonjakan tidak menjadi lonjakan query DB.
 */
export class EventMetaCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly prisma: PrismaClient;
  private readonly ttlMs: number;

  constructor(prisma: PrismaClient, ttlMs: number) {
    this.prisma = prisma;
    this.ttlMs = ttlMs;
  }

  get(eventId: string): Promise<EventMeta | null> {
    const now = Date.now();
    const cached = this.entries.get(eventId);

    if (cached !== undefined && now - cached.loadedAt < this.ttlMs) {
      return cached.value;
    }

    const value = loadEventMeta(this.prisma, eventId).catch((error: Error) => {
      this.entries.delete(eventId);
      throw error;
    });

    this.entries.set(eventId, { loadedAt: now, value });

    return value;
  }

  invalidate(eventId: string): void {
    this.entries.delete(eventId);
  }
}

/** Status antrean yang seharusnya berlaku menurut jadwal event saja. */
export function scheduledQueueStatus(meta: EventMeta, now: Date): QueueStatus {
  if (meta.status === "DRAFT" || meta.status === "ENDED" || now >= meta.startsAt) {
    return "CLOSED";
  }

  if (now < meta.preQueueAt) {
    return "SCHEDULED";
  }

  if (now < meta.saleOpensAt) {
    return "PREQUEUE";
  }

  return "OPEN";
}

/** Menggabungkan status jadwal dengan status yang diatur manual (pause) atau terminal (sold out). */
export function nextQueueStatus(current: QueueStatus | null, scheduled: QueueStatus): QueueStatus {
  if (scheduled === "CLOSED") {
    return "CLOSED";
  }

  if (current === "SOLD_OUT") {
    return "SOLD_OUT";
  }

  if (current === "PAUSED" && scheduled === "OPEN") {
    return "PAUSED";
  }

  return scheduled;
}

export async function readQueueStatus(
  ctx: CoreContext,
  eventId: string,
): Promise<QueueStatus | null> {
  const raw = await ctx.redis.get(keys.status(eventId));

  return isQueueStatus(raw) ? raw : null;
}

export async function writeEventConfig(ctx: CoreContext, meta: EventMeta): Promise<void> {
  await ctx.redis.hset(keys.config(meta.id), {
    admitPerSec: meta.admitPerSec,
    maxActive: meta.maxActive,
    maxPerUser: meta.maxPerUser,
  });
}

/**
 * Menyelaraskan state event di Redis dengan PostgreSQL:
 * - stok kategori diinisialisasi dari DB bila belum ada (SET NX, tidak menimpa stok berjalan),
 * - konfigurasi admission ditulis ke hash config,
 * - status antrean dihitung dari jadwal.
 */
export async function syncEventToRedis(
  ctx: CoreContext,
  meta: EventMeta,
  now: Date,
): Promise<QueueStatus> {
  const pipeline = ctx.redis.pipeline();

  for (const category of meta.categories) {
    const available = category.quota - category.sold - category.reserved;

    pipeline.set(keys.stock(meta.id, category.id), Math.max(0, available), "NX");
  }

  if (meta.categories.length > 0) {
    pipeline.sadd(keys.categories(meta.id), ...meta.categories.map((category) => category.id));
  }

  await pipeline.exec();
  await writeEventConfig(ctx, meta);

  const current = await readQueueStatus(ctx, meta.id);
  const next = nextQueueStatus(current, scheduledQueueStatus(meta, now));

  if (next !== current) {
    await ctx.redis.set(keys.status(meta.id), next);
  }

  return next;
}

export function eventStatusFor(queueStatus: QueueStatus, current: EventStatus): EventStatus {
  if (current === "DRAFT") {
    return "DRAFT";
  }

  switch (queueStatus) {
    case "OPEN":
    case "PAUSED":
      return "ON_SALE";
    case "SOLD_OUT":
      return "SOLD_OUT";
    case "CLOSED":
      return "ENDED";
    case "SCHEDULED":
    case "PREQUEUE":
      return "SCHEDULED";
  }
}
