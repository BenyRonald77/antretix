import { z } from "zod";

export const registerSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export const devLoginSchema = z.object({
  email: z.email().max(200),
});

export const joinQueueSchema = z.object({
  turnstileToken: z.string().max(4096).optional(),
});

export const createOrderSchema = z.object({
  categoryId: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(10),
});

export const idempotencyKeySchema = z.string().min(8).max(100);

export const categoryInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(60),
  price: z.number().int().min(0),
  quota: z.number().int().min(1).max(1_000_000),
});

export const eventInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(200),
    venue: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    posterUrl: z.string().max(500).default(""),
    startsAt: z.coerce.date(),
    saleOpensAt: z.coerce.date(),
    preQueueAt: z.coerce.date().optional(),
    status: z.enum(["DRAFT", "SCHEDULED"]).default("SCHEDULED"),
    admitPerSec: z.number().int().min(1).max(10_000).default(50),
    maxActive: z.number().int().min(1).max(100_000).default(500),
    maxPerUser: z.number().int().min(1).max(20).default(4),
    categories: z.array(categoryInputSchema).min(1).max(20),
  })
  .refine((value) => value.saleOpensAt < value.startsAt, {
    message: "Penjualan harus dibuka sebelum konser dimulai",
    path: ["saleOpensAt"],
  });

export const queueControlSchema = z.object({
  admitPerSec: z.number().int().min(1).max(10_000).optional(),
  maxActive: z.number().int().min(1).max(100_000).optional(),
  action: z.enum(["pause", "resume"]).optional(),
});

export const paymentWebhookSchema = z.object({
  orderId: z.string().min(1),
  transactionId: z.string().min(1),
  status: z.enum(["settlement", "failed"]),
  amount: z.number().int(),
  timestamp: z.number().int(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export type LoginInput = z.infer<typeof loginSchema>;

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type EventInput = z.infer<typeof eventInputSchema>;

export type QueueControlInput = z.infer<typeof queueControlSchema>;

export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;
