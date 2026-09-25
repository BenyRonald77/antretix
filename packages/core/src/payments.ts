import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError, keys, type PaymentWebhookPayload } from "@antretix/shared";
import { z } from "zod";
import { newTicketCode } from "./codes";
import type { CoreContext } from "./context";
import { recordStat, releaseOrder } from "./orders";
import { leaveQueue } from "./queue";

const SIGNATURE_MAX_AGE_MS = 5 * 60_000;

const paidRows = z.array(z.object({ paid: z.boolean() }));

/**
 * Tanda tangan webhook mock provider, meniru pola Midtrans (hash dari field kunci + server key):
 * HMAC-SHA256(secret, "orderId:transactionId:status:amount:timestamp").
 */
export function signPayment(payload: PaymentWebhookPayload, secret: string): string {
  const message = `${payload.orderId}:${payload.transactionId}:${payload.status}:${payload.amount}:${payload.timestamp}`;

  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyPaymentSignature(
  payload: PaymentWebhookPayload,
  signature: string,
  secret: string,
  nowMs: number,
): boolean {
  if (Math.abs(nowMs - payload.timestamp) > SIGNATURE_MAX_AGE_MS) {
    return false;
  }

  const expected = Buffer.from(signPayment(payload, secret), "hex");
  const actual = Buffer.from(signature, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function mockPaymentPayload(
  orderId: string,
  amount: number,
  success: boolean,
): PaymentWebhookPayload {
  return {
    orderId,
    transactionId: `MOCK-${randomUUID()}`,
    status: success ? "settlement" : "failed",
    amount,
    timestamp: Date.now(),
  };
}

export type PaymentOutcome = "PAID" | "ALREADY_PAID" | "REFUNDED" | "CANCELLED" | "IGNORED";

/**
 * Memproses notifikasi pembayaran yang signature-nya sudah diverifikasi.
 * - settlement + order PENDING  -> PAID, reserved dipindah ke sold, e-ticket diterbitkan.
 * - settlement + order EXPIRED/CANCELLED -> REFUNDED (stok sudah dikembalikan sebelumnya).
 * - failed + order PENDING -> CANCELLED, stok dikembalikan.
 * Semua transisi bersyarat, jadi webhook yang dikirim ulang tidak memproses dua kali.
 */
export async function handlePaymentNotification(
  ctx: CoreContext,
  payload: PaymentWebhookPayload,
): Promise<PaymentOutcome> {
  const order = await ctx.prisma.order.findUnique({
    where: { id: payload.orderId },
    include: { items: { include: { category: true } } },
  });

  if (order === null) {
    throw new AppError("NOT_FOUND", "Order tidak ditemukan");
  }

  if (payload.status === "failed") {
    return (await releaseOrder(ctx, order.id, "CANCELLED")) ? "CANCELLED" : "IGNORED";
  }

  if (payload.amount !== order.totalPrice) {
    throw new AppError("VALIDATION_ERROR", "Nominal pembayaran tidak sesuai");
  }

  if (order.status === "PAID") {
    return "ALREADY_PAID";
  }

  if (order.status === "EXPIRED" || order.status === "CANCELLED") {
    const refunded = await ctx.prisma.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: "REFUNDED", refundedAt: new Date(), paymentRef: payload.transactionId },
    });

    return refunded.count === 1 ? "REFUNDED" : "IGNORED";
  }

  if (order.status !== "PENDING") {
    return "IGNORED";
  }

  let ticketCount = 0;

  for (const item of order.items) {
    ticketCount += item.qty;
  }

  // Satu statement di PostgreSQL: PENDING -> PAID, tiket diterbitkan, reserved dipindah ke sold.
  const rows = paidRows.parse(
    await ctx.prisma.$queryRaw`
      SELECT antretix_pay_order(${order.id}, ${payload.transactionId}, ${Array.from({ length: ticketCount }, newTicketCode)}::text[]) AS paid`,
  );

  const paid = rows[0]?.paid === true;

  if (!paid) {
    // Kalah balapan dengan job expiry: order sudah bukan PENDING, proses ulang sebagai refund.
    return handlePaymentNotification(ctx, payload);
  }

  await recordStat(ctx, keys.paidStats(order.eventId), order.id);
  // Pembeli yang sudah membayar melepas slot aktifnya agar orang berikutnya bisa masuk.
  await leaveQueue(ctx, order.eventId, order.userId);

  return "PAID";
}
