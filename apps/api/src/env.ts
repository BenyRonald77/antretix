import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TRUST_PROXY: z.string().default("1"),
  AUTH_JWT_SECRET: z.string().min(16),
  QUEUE_JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  TURNSTILE_SECRET: z.string().default("1x0000000000000000000000000000000AA"),
  TURNSTILE_BYPASS: booleanFlag,
  PAYMENT_WEBHOOK_SECRET: z.string().min(8),
  PAYMENT_WEBHOOK_URL: z.string().default("http://localhost:4000/payments/webhook"),
  LOADTEST_MODE: booleanFlag,
  RL_JOIN_PER_MIN: z.coerce.number().int().positive().default(5),
  RL_STATUS_PER_MIN: z.coerce.number().int().positive().default(30),
  RL_CHECKOUT_PER_MIN: z.coerce.number().int().positive().default(10),
  RL_GLOBAL_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  SSE_INTERVAL_MS: z.coerce.number().int().min(500).default(2000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

/**
 * TRUST_PROXY: "true" = percaya semua hop (load test dengan X-Forwarded-For palsu),
 * angka = jumlah hop proxy yang dipercaya (1 = nginx).
 */
export function trustProxySetting(
  value: string,
): boolean | ((address: string, hop: number) => boolean) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const hops = Number(value);

  const trustedHops = Number.isInteger(hops) && hops >= 0 ? hops : 1;

  return (_address, hop) => hop < trustedHops;
}
