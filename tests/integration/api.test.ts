import { buildApp, type BuiltApp } from "@antretix/api";
import { signPayment, mockPaymentPayload } from "@antretix/core";
import { keys } from "@antretix/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { loadEnv } from "../../apps/api/src/env";
import { seedEvent } from "./helpers";

let built: BuiltApp;

const WEBHOOK_SECRET = "test-webhook-secret";

beforeAll(async () => {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
    AUTH_JWT_SECRET: "test-auth-secret-0123456789",
    QUEUE_JWT_SECRET: "test-queue-secret-0123456789",
    PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TURNSTILE_BYPASS: "true",
    LOADTEST_MODE: "true",
    RL_JOIN_PER_MIN: "3",
    RL_GLOBAL_IP_PER_MIN: "100000",
    LOG_LEVEL: "silent",
  });

  built = await buildApp(env);
});

afterAll(async () => {
  await built.close();
});

let ipCounter = 0;

/** Setiap skenario memakai IP sendiri, karena rate limiter join juga berlaku per IP. */
function nextIp(): string {
  ipCounter += 1;

  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function login(email: string): Promise<string> {
  const response = await built.app.inject({
    method: "POST",
    url: "/auth/dev-login",
    payload: { email },
  });

  const body = response.json();

  return String(body.token);
}

describe("perlindungan checkout", () => {
  it("checkout tanpa token antrean → 401, token akun lain → 401", async () => {
    const { meta, categoryId } = await seedEvent(built.deps.ctx, 10);
    const alice = await login(`alice-${meta.id}@uji.dev`);
    const bob = await login(`bob-${meta.id}@uji.dev`);
    const order = { categoryId, qty: 1 };

    const withoutToken = await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/orders`,
      headers: { authorization: `Bearer ${alice}`, "idempotency-key": "no-token-001" },
      payload: order,
    });

    expect(withoutToken.statusCode).toBe(401);
    expect(withoutToken.json()).toMatchObject({ code: "QUEUE_TOKEN_REQUIRED" });

    // Bob mengantre dan di-admit, lalu Alice mencoba memakai token milik Bob.
    await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/queue`,
      headers: { authorization: `Bearer ${bob}` },
      payload: {},
      remoteAddress: nextIp(),
    });
    await built.deps.ctx.lua.admit(meta, Date.now(), {
      admitPerSec: 10,
      maxActive: 10,
      sessionTtlMs: 600_000,
    });

    const status = await built.app.inject({
      method: "GET",
      url: `/events/${meta.id}/queue/status`,
      headers: { authorization: `Bearer ${bob}` },
    });

    const state = status.json().state;

    expect(state.state).toBe("ADMITTED");

    const stolen = await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/orders`,
      headers: {
        authorization: `Bearer ${alice}`,
        "x-queue-token": state.token,
        "idempotency-key": "stolen-001",
      },
      payload: order,
    });

    expect(stolen.statusCode).toBe(401);

    const legit = await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/orders`,
      headers: {
        authorization: `Bearer ${bob}`,
        "x-queue-token": state.token,
        "idempotency-key": "legit-0001",
      },
      payload: order,
    });

    expect(legit.statusCode).toBe(201);
  });

  it("join antrean melewati batas → 429 dengan Retry-After", async () => {
    const { meta } = await seedEvent(built.deps.ctx, 10);
    const token = await login(`spam-${meta.id}@uji.dev`);
    const ip = nextIp();
    const codes: number[] = [];
    let retryAfter: string | undefined;

    for (let index = 0; index < 5; index += 1) {
      const response = await built.app.inject({
        method: "POST",
        url: `/events/${meta.id}/queue`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
        remoteAddress: ip,
      });

      codes.push(response.statusCode);

      if (response.statusCode === 429) {
        retryAfter = String(response.headers["retry-after"]);
      }
    }

    expect(codes.slice(0, 3)).toEqual([202, 202, 202]);
    expect(codes.slice(3)).toEqual([429, 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("status antrean SOLD_OUT → 410", async () => {
    const { meta } = await seedEvent(built.deps.ctx, 10);
    const token = await login(`late-${meta.id}@uji.dev`);

    await built.deps.ctx.redis.set(keys.status(meta.id), "SOLD_OUT");

    const response = await built.app.inject({
      method: "GET",
      url: `/events/${meta.id}/queue/status`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(410);
  });
});

describe("webhook pembayaran", () => {
  async function pendingOrder(): Promise<{
    orderId: string;
    amount: number;
    eventId: string;
    categoryId: string;
  }> {
    const { meta, categoryId } = await seedEvent(built.deps.ctx, 10);
    const token = await login(`payer-${meta.id}@uji.dev`);

    await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/queue`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
      remoteAddress: nextIp(),
    });
    await built.deps.ctx.lua.admit(meta, Date.now(), {
      admitPerSec: 10,
      maxActive: 10,
      sessionTtlMs: 600_000,
    });

    const status = await built.app.inject({
      method: "GET",
      url: `/events/${meta.id}/queue/status`,
      headers: { authorization: `Bearer ${token}` },
    });

    const created = await built.app.inject({
      method: "POST",
      url: `/events/${meta.id}/orders`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-queue-token": status.json().state.token,
        "idempotency-key": "pay-order-1",
      },
      payload: { categoryId, qty: 2 },
    });

    const order = created.json().order;

    return { orderId: order.id, amount: order.totalPrice, eventId: meta.id, categoryId };
  }

  it("signature salah ditolak; signature benar menerbitkan tiket; webhook ulang idempoten", async () => {
    const { orderId, amount, categoryId } = await pendingOrder();
    const payload = mockPaymentPayload(orderId, amount, true);

    const forged = await built.app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: { ...payload, signature: "00".repeat(32) },
    });

    expect(forged.statusCode).toBe(401);

    const signed = { ...payload, signature: signPayment(payload, WEBHOOK_SECRET) };

    const first = await built.app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: signed,
    });

    const replay = await built.app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: signed,
    });

    expect(first.json()).toMatchObject({ code: "PAID" });
    expect(replay.json()).toMatchObject({ code: "ALREADY_PAID" });
    expect(await built.deps.ctx.prisma.ticket.count({ where: { orderId } })).toBe(2);

    const category = await built.deps.ctx.prisma.ticketCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    expect(category).toMatchObject({ sold: 2, reserved: 0 });
  });

  it("pembayaran yang datang setelah order kedaluwarsa memicu refund", async () => {
    const { orderId, amount } = await pendingOrder();

    await built.deps.ctx.prisma.order.update({
      where: { id: orderId },
      data: { status: "EXPIRED" },
    });

    const payload = mockPaymentPayload(orderId, amount, true);

    const response = await built.app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: { ...payload, signature: signPayment(payload, WEBHOOK_SECRET) },
    });

    expect(response.json()).toMatchObject({ code: "REFUNDED" });
    expect(
      (await built.deps.ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe("REFUNDED");
  });
});
