import { randomUUID } from "node:crypto";
import { AppError, keys } from "@antretix/shared";
import type { LuaScripts } from "@antretix/lua";
import { z } from "zod";
import type { ApiMetrics } from "./metrics";

const WINDOW_MS = 60_000;

export interface RateLimitRule {
  scope: string;
  id: string;
  limitPerMinute: number;
}

export interface RateLimitLimits {
  RL_GLOBAL_IP_PER_MIN: number;
  RL_JOIN_PER_MIN: number;
  RL_STATUS_PER_MIN: number;
  RL_CHECKOUT_PER_MIN: number;
}

/**
 * Aturan rate limit untuk satu request (PRD: join 5/menit per IP + per user, status 30/menit per user,
 * checkout 10/menit per user, global 120/menit per IP). Aturan per user dilewati bila belum login,
 * karena route-nya sendiri akan menolak dengan 401.
 */
export function rateLimitRulesFor(
  limits: RateLimitLimits,
  method: string,
  route: string,
  ip: string,
  userId: string | null,
): RateLimitRule[] {
  const rules: RateLimitRule[] = [
    { scope: "ip", id: ip, limitPerMinute: limits.RL_GLOBAL_IP_PER_MIN },
  ];

  const key = `${method} ${route}`;

  if (key === "POST /events/:id/queue") {
    rules.push({ scope: "join-ip", id: ip, limitPerMinute: limits.RL_JOIN_PER_MIN });

    if (userId !== null) {
      rules.push({ scope: "join-user", id: userId, limitPerMinute: limits.RL_JOIN_PER_MIN });
    }
  }

  const isStatus = key === "GET /events/:id/queue/status" || key === "GET /events/:id/queue/stream";

  if (isStatus && userId !== null) {
    rules.push({ scope: "status", id: userId, limitPerMinute: limits.RL_STATUS_PER_MIN });
  }

  if (key === "POST /events/:id/orders" && userId !== null) {
    rules.push({ scope: "checkout", id: userId, limitPerMinute: limits.RL_CHECKOUT_PER_MIN });
  }

  return rules;
}

/**
 * Sliding window log di Redis: semua aturan dicek dalam satu panggilan Lua atomik.
 * Melempar 429 RATE_LIMITED dengan header Retry-After bila salah satu aturan terlampaui.
 */
export async function enforceRateLimits(
  lua: LuaScripts,
  metrics: ApiMetrics,
  rules: readonly RateLimitRule[],
): Promise<void> {
  const now = Date.now();

  const result = await lua.rateLimit(
    rules.map((rule) => ({
      key: keys.rateLimit(rule.scope, rule.id),
      windowMs: WINDOW_MS,
      limit: rule.limitPerMinute,
    })),
    now,
    `${now}-${randomUUID()}`,
  );

  const blocked = rules[result.blockedIndex];

  if (blocked !== undefined) {
    metrics.rateLimited.inc({ scope: blocked.scope });

    throw new AppError("RATE_LIMITED", "Terlalu banyak request, coba lagi sebentar", {
      "retry-after": String(Math.ceil(result.retryAfterMs / 1000)),
    });
  }
}

const siteverifyResponse = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

export interface TurnstileConfig {
  secret: string;
  bypass: boolean;
}

/** Verifikasi token Cloudflare Turnstile di server (siteverify). */
export async function verifyTurnstile(
  config: TurnstileConfig,
  token: string | undefined,
  ip: string,
): Promise<void> {
  if (config.bypass) {
    return;
  }

  if (token === undefined || token.length === 0) {
    throw new AppError("TURNSTILE_FAILED", "Verifikasi anti-bot wajib diisi");
  }

  const body = new URLSearchParams({ secret: config.secret, response: token, remoteip: ip });
  let result: z.infer<typeof siteverifyResponse>;

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });

    result = siteverifyResponse.parse(await response.json());
  } catch {
    throw new AppError(
      "TURNSTILE_FAILED",
      "Layanan verifikasi anti-bot tidak dapat dihubungi, coba lagi",
    );
  }

  if (!result.success) {
    throw new AppError("TURNSTILE_FAILED", "Verifikasi anti-bot gagal, silakan ulangi");
  }
}
