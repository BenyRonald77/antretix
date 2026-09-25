import type { OrderStatusName } from "./constants";

export type LimitDecision = "OK" | "LIMIT_EXCEEDED" | "INVALID_QTY";

/** Batas tiket per akun per event dihitung lintas semua order yang masih memegang tiket. */
export function checkPerUserLimit(
  alreadyHeld: number,
  requested: number,
  maxPerUser: number,
): LimitDecision {
  if (!Number.isInteger(requested) || requested < 1) {
    return "INVALID_QTY";
  }

  if (alreadyHeld + requested > maxPerUser) {
    return "LIMIT_EXCEEDED";
  }

  return "OK";
}

const ORDER_TRANSITIONS: Record<OrderStatusName, readonly OrderStatusName[]> = {
  PENDING: ["PAID", "EXPIRED", "CANCELLED"],
  PAID: ["REFUNDED"],
  EXPIRED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatusName, to: OrderStatusName): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Order yang masih memegang kuota tiket, sehingga dihitung ke batas per akun. */
export function holdsTickets(status: OrderStatusName): boolean {
  return status === "PENDING" || status === "PAID";
}
