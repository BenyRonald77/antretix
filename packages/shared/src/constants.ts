export const QUEUE_STATUSES = [
  "SCHEDULED",
  "PREQUEUE",
  "OPEN",
  "PAUSED",
  "SOLD_OUT",
  "CLOSED",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const ORDER_STATUSES = ["PENDING", "PAID", "EXPIRED", "CANCELLED", "REFUNDED"] as const;

export type OrderStatusName = (typeof ORDER_STATUSES)[number];

/** Nilai default aturan bisnis v1.0. Nilai aktual per event disimpan di tabel Event dan hash config:{event}. */
export const DEFAULTS = {
  admitPerSec: 50,
  maxActive: 500,
  maxPerUser: 4,
  accessTokenTtlSec: 10 * 60,
  holdTtlSec: 10 * 60,
  heartbeatTimeoutSec: 2 * 60,
  preQueueMinutes: 30,
  etaWindowSec: 60,
} as const;

export const QUEUE_TOKEN_HEADER = "x-queue-token";

export const IDEMPOTENCY_HEADER = "idempotency-key";

export function isQueueStatus(value: string | null): value is QueueStatus {
  return QUEUE_STATUSES.some((status) => status === value);
}
