import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { defaultSettings, type CoreContext } from "@antretix/core";
import { createPrisma } from "@antretix/db";
import { LuaScripts } from "@antretix/lua";
import { Redis } from "ioredis";
import { z } from "zod";
import { consoleLogger, DEFAULT_INTERVALS, Worker } from "./jobs";
import { createWorkerMetrics, serveMetrics } from "./metrics";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WORKER_METRICS_PORT: z.coerce.number().int().default(9101),
    EXPIRY_INTERVAL_MS: z.coerce.number().int().positive().default(DEFAULT_INTERVALS.expiryMs),
  })
  .parse(process.env);

const instanceId = `${hostname()}-${randomUUID().slice(0, 8)}`;

const prisma = createPrisma(env.DATABASE_URL);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

const ctx: CoreContext = { prisma, redis, lua: new LuaScripts(redis), settings: defaultSettings() };

const metrics = createWorkerMetrics(instanceId);

const server = serveMetrics(metrics.registry, env.WORKER_METRICS_PORT);

const worker = new Worker(
  ctx,
  metrics,
  instanceId,
  { ...DEFAULT_INTERVALS, expiryMs: env.EXPIRY_INTERVAL_MS },
  consoleLogger,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    consoleLogger("info", `${signal} diterima, worker berhenti`);
    worker.stop();
    server.close();
    void prisma.$disconnect().finally(() => {
      redis.disconnect();
      process.exit(0);
    });
  });
}

await worker.start();
