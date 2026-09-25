import { keys } from "@antretix/shared";
import type { CoreContext } from "./context";

export interface ReconcileRow {
  eventId: string;
  categoryId: string;
  categoryName: string;
  dbAvailable: number;
  redisStock: number;
  diff: number;
  healed: boolean;
}

/** Berapa kali berturut-turut selisih yang sama harus terlihat sebelum stok Redis dikoreksi. */
const HEAL_AFTER_RUNS = 3;

/**
 * Rekonsiliasi stok Redis vs PostgreSQL: bandingkan (quota - sold - reserved) dengan stock:{event}:{cat}.
 *
 * Selisih sesaat wajar (reservasi sedang berjalan: Redis sudah berkurang, transaksi DB belum commit),
 * jadi selisih hanya dikoreksi bila nilainya persis sama selama beberapa putaran berturut-turut.
 * Koreksi memakai INCRBY delta, bukan SET, agar tidak menimpa operasi yang terjadi di antaranya.
 * PostgreSQL tetap sumber kebenaran; Redis hanya penyaring cepat.
 */
export async function reconcileStock(ctx: CoreContext, eventId: string): Promise<ReconcileRow[]> {
  const categories = await ctx.prisma.ticketCategory.findMany({
    where: { eventId },
    orderBy: { sortOrder: "asc" },
  });

  const rows: ReconcileRow[] = [];

  for (const category of categories) {
    const stockKey = keys.stock(eventId, category.id);
    const raw = await ctx.redis.get(stockKey);

    if (raw === null) {
      continue;
    }

    const dbAvailable = category.quota - category.sold - category.reserved;
    const redisStock = Number(raw);
    const diff = redisStock - dbAvailable;
    const trackerKey = keys.reconcileDiff(eventId, category.id);
    let healed = false;

    if (diff === 0) {
      await ctx.redis.del(trackerKey);
    } else {
      const tracker = await ctx.redis.hgetall(trackerKey);
      const runs = tracker.diff === String(diff) ? Number(tracker.runs ?? "0") + 1 : 1;

      if (runs >= HEAL_AFTER_RUNS) {
        await ctx.redis.incrby(stockKey, -diff);
        await ctx.redis.del(trackerKey);
        healed = true;
      } else {
        await ctx.redis.multi().hset(trackerKey, { diff, runs }).expire(trackerKey, 600).exec();
      }
    }

    rows.push({
      eventId,
      categoryId: category.id,
      categoryName: category.name,
      dbAvailable,
      redisStock,
      diff,
      healed,
    });
  }

  return rows;
}
