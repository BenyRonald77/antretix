import { z } from "zod";
import { ORDER_STATUSES, QUEUE_STATUSES } from "./constants";

/**
 * Kontrak respons API sebagai skema Zod. API memakai tipe hasil infer-nya,
 * frontend memakai skemanya untuk mem-parse respons di batas I/O.
 */
const etaRangeSchema = z.object({ minSec: z.number(), maxSec: z.number() });

export const queueStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("NOT_STARTED"), preQueueAt: z.string(), saleOpensAt: z.string() }),
  z.object({ state: z.literal("WAITING_ROOM"), saleOpensAt: z.string() }),
  z.object({
    state: z.literal("WAITING"),
    position: z.number(),
    ahead: z.number(),
    total: z.number(),
    eta: etaRangeSchema.nullable(),
    paused: z.boolean(),
    stockExhausted: z.boolean(),
  }),
  z.object({ state: z.literal("ADMITTED"), token: z.string(), expiresAt: z.string() }),
  z.object({ state: z.literal("NOT_IN_QUEUE"), queueStatus: z.enum(QUEUE_STATUSES) }),
  z.object({ state: z.literal("SOLD_OUT") }),
]);

export type QueueState = z.infer<typeof queueStateSchema>;

export const categoryViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  quota: z.number(),
  remaining: z.number(),
});

export type CategoryView = z.infer<typeof categoryViewSchema>;

export const eventViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  venue: z.string(),
  description: z.string(),
  posterUrl: z.string(),
  startsAt: z.string(),
  saleOpensAt: z.string(),
  preQueueAt: z.string(),
  status: z.string(),
  queueStatus: z.enum(QUEUE_STATUSES),
  maxPerUser: z.number(),
  serverTime: z.string(),
  categories: z.array(categoryViewSchema),
});

export type EventView = z.infer<typeof eventViewSchema>;

export const orderViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  status: z.enum(ORDER_STATUSES),
  totalPrice: z.number(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  serverTime: z.string(),
  items: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      qty: z.number(),
      unitPrice: z.number(),
    }),
  ),
  tickets: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      categoryName: z.string(),
      checkedIn: z.boolean(),
    }),
  ),
});

export type OrderView = z.infer<typeof orderViewSchema>;

export const adminMetricsSchema = z.object({
  eventId: z.string(),
  queueStatus: z.enum(QUEUE_STATUSES),
  queueLength: z.number(),
  activeUsers: z.number(),
  admitPerSec: z.number(),
  maxActive: z.number(),
  observedAdmitPerSec: z.number(),
  ordersPerMinute: z.number(),
  paidPerMinute: z.number(),
  totalSold: z.number(),
  totalReserved: z.number(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quota: z.number(),
      sold: z.number(),
      reserved: z.number(),
      redisStock: z.number(),
    }),
  ),
  timestamp: z.string(),
});

export type AdminMetrics = z.infer<typeof adminMetricsSchema>;

export const authUserViewSchema = z.object({
  sub: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["CUSTOMER", "ADMIN"]),
});

export type AuthUserView = z.infer<typeof authUserViewSchema>;

export const apiErrorSchema = z.object({ code: z.string(), message: z.string() });
