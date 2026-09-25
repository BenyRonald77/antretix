import {
  createOrder,
  getOrderView,
  handlePaymentNotification,
  listUserOrders,
  mockPaymentPayload,
  releaseOrder,
  signPayment,
  verifyPaymentSignature,
} from "@antretix/core";
import {
  AppError,
  createOrderSchema,
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
  paymentWebhookSchema,
} from "@antretix/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireQueueToken, requireUser, type AuthUser } from "../auth";
import { eventParams, requireEvent } from "./events";

const WEBHOOK_RETRY_DELAYS_MS = [300, 1000, 2000, 4000, 8000, 16_000];

/**
 * Mock provider mengirim webhook seperti penyedia pembayaran sungguhan: bila server kita membalas
 * selain 2xx (mis. sedang sibuk), pengiriman diulang dengan jeda yang makin panjang.
 * Aman diulang karena pemrosesan webhook idempoten.
 */
async function deliverWebhook(url: string, body: string): Promise<boolean> {
  for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // koneksi gagal: coba lagi pada jeda berikutnya
    }
  }

  return false;
}

const orderParams = z.object({ id: z.string().min(1).max(64) });

const payBody = z.object({ outcome: z.enum(["success", "fail"]).default("success") });

const webhookBody = paymentWebhookSchema.extend({ signature: z.string().min(1).max(256) });

export function registerOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { ctx, env, metrics } = deps;

  async function ownedOrder(request: FastifyRequest, user: AuthUser) {
    const { id } = orderParams.parse(request.params);
    const order = await getOrderView(ctx.prisma, id);

    if (order === null || (order.userId !== user.sub && user.role !== "ADMIN")) {
      throw new AppError("NOT_FOUND", "Order tidak ditemukan");
    }

    return order;
  }

  app.post("/events/:id/orders", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);

    requireQueueToken(deps.tokens, request, id, user.sub);

    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers[IDEMPOTENCY_HEADER]);

    if (!idempotencyKey.success) {
      throw new AppError("VALIDATION_ERROR", "Header Idempotency-Key wajib diisi (8-100 karakter)");
    }

    const input = createOrderSchema.parse(request.body);
    const meta = await requireEvent(deps, id);

    try {
      const result = await createOrder(ctx, {
        meta,
        userId: user.sub,
        categoryId: input.categoryId,
        qty: input.qty,
        idempotencyKey: idempotencyKey.data,
      });

      metrics.ordersCreated.inc({ result: result.created ? "CREATED" : "IDEMPOTENT_REPLAY" });

      return reply.status(result.created ? 201 : 200).send({ order: result.order });
    } catch (error) {
      metrics.ordersCreated.inc({ result: error instanceof AppError ? error.code : "ERROR" });
      throw error;
    }
  });

  app.get("/orders/:id", async (request) => {
    const user = requireUser(request);
    const { userId: _owner, ...order } = await ownedOrder(request, user);

    return { order };
  });

  app.get("/me/orders", async (request) => {
    const user = requireUser(request);

    return { orders: await listUserOrders(ctx.prisma, user.sub) };
  });

  app.post("/orders/:id/cancel", async (request) => {
    const user = requireUser(request);
    const order = await ownedOrder(request, user);

    if (order.status !== "PENDING") {
      throw new AppError("CONFLICT", "Hanya order yang menunggu pembayaran yang bisa dibatalkan");
    }

    await releaseOrder(ctx, order.id, "CANCELLED");

    return { code: "CANCELLED" };
  });

  /**
   * Mock payment provider. Meniru alur Midtrans: pembeli "membayar" di provider,
   * lalu provider memanggil webhook kita secara asinkron dengan payload bertanda tangan.
   */
  app.post("/orders/:id/pay", async (request, reply) => {
    const user = requireUser(request);
    const order = await ownedOrder(request, user);
    const { outcome } = payBody.parse(request.body ?? {});

    if (order.status !== "PENDING") {
      throw new AppError("CONFLICT", `Order berstatus ${order.status}, tidak bisa dibayar`);
    }

    const payload = mockPaymentPayload(order.id, order.totalPrice, outcome === "success");
    const signature = signPayment(payload, env.PAYMENT_WEBHOOK_SECRET);

    void deliverWebhook(env.PAYMENT_WEBHOOK_URL, JSON.stringify({ ...payload, signature })).then(
      (delivered) => {
        if (!delivered) {
          request.log.error({ orderId: order.id }, "mock provider menyerah mengirim webhook");
        }
      },
    );

    return reply.status(202).send({ code: "PROCESSING", transactionId: payload.transactionId });
  });

  app.post("/payments/webhook", async (request, reply) => {
    const body = webhookBody.parse(request.body);
    const { signature, ...payload } = body;

    if (!verifyPaymentSignature(payload, signature, env.PAYMENT_WEBHOOK_SECRET, Date.now())) {
      return reply
        .status(401)
        .send({ code: "UNAUTHORIZED", message: "Signature webhook tidak valid" });
    }

    const outcome = await handlePaymentNotification(ctx, payload);

    if (outcome === "REFUNDED") {
      request.log.warn(
        { orderId: payload.orderId },
        "pembayaran masuk setelah order kedaluwarsa, refund diproses",
      );
    }

    return { code: outcome };
  });
}
