import { DEFAULTS, estimateWait, keys, type QueueState } from "@antretix/shared";
import type { CoreContext } from "./context";
import type { EventMeta } from "./events";

export interface QueueTokenClaims {
  userId: string;
  eventId: string;
  expiresAtMs: number;
}

export type QueueTokenSigner = (claims: QueueTokenClaims) => string;

const ETA_WINDOW_MS = DEFAULTS.etaWindowSec * 1000;

/**
 * Status antrean seorang pengguna. Selama PREQUEUE posisi sengaja tidak dikembalikan,
 * karena urutannya masih berupa undian (skor acak) yang baru "terbuka" saat jam penjualan.
 */
export async function getQueueState(
  ctx: CoreContext,
  meta: EventMeta,
  userId: string,
  sign: QueueTokenSigner,
  nowMs: number = Date.now(),
): Promise<QueueState> {
  const snapshot = await ctx.lua.status(meta, userId, nowMs, ETA_WINDOW_MS);

  if (snapshot.queueStatus === "SOLD_OUT") {
    return { state: "SOLD_OUT" };
  }

  if (snapshot.admittedPttlMs > 0 && snapshot.activeExpiresAt > nowMs) {
    const token = sign({ userId, eventId: meta.id, expiresAtMs: snapshot.activeExpiresAt });

    return {
      state: "ADMITTED",
      token,
      expiresAt: new Date(snapshot.activeExpiresAt).toISOString(),
    };
  }

  if (snapshot.queueStatus === "SCHEDULED") {
    return {
      state: "NOT_STARTED",
      preQueueAt: meta.preQueueAt.toISOString(),
      saleOpensAt: meta.saleOpensAt.toISOString(),
    };
  }

  if (snapshot.rank < 0) {
    return { state: "NOT_IN_QUEUE", queueStatus: toQueueStatus(snapshot.queueStatus) };
  }

  if (snapshot.queueStatus === "PREQUEUE") {
    return { state: "WAITING_ROOM", saleOpensAt: meta.saleOpensAt.toISOString() };
  }

  const paused = snapshot.queueStatus === "PAUSED";
  const stockExhausted = snapshot.stockTotal <= 0;
  const observed = snapshot.admitsInWindow / DEFAULTS.etaWindowSec;
  const fallback = paused || stockExhausted ? 0 : snapshot.admitPerSec;

  return {
    state: "WAITING",
    position: snapshot.rank + 1,
    ahead: snapshot.rank,
    total: snapshot.total,
    eta: paused || stockExhausted ? null : estimateWait(snapshot.rank + 1, observed, fallback),
    paused,
    stockExhausted,
  };
}

function toQueueStatus(raw: string) {
  switch (raw) {
    case "PREQUEUE":
    case "OPEN":
    case "PAUSED":
    case "SOLD_OUT":
    case "CLOSED":
      return raw;
    default:
      return "SCHEDULED";
  }
}

/** Mengeluarkan pengguna dari antrean dan sesi aktif (keluar sukarela atau setelah membayar). */
export async function leaveQueue(ctx: CoreContext, eventId: string, userId: string): Promise<void> {
  await ctx.redis
    .multi()
    .zrem(keys.queue(eventId), userId)
    .zrem(keys.heartbeat(eventId), userId)
    .zrem(keys.active(eventId), userId)
    .del(keys.admitted(eventId, userId))
    .exec();
}
