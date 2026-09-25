import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import {
  defaultSettings,
  EventMetaCache,
  type CoreContext,
  type CoreSettings,
} from "@antretix/core";
import { createPrisma } from "@antretix/db";
import { LuaScripts } from "@antretix/lua";
import { AppError } from "@antretix/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { z, ZodError } from "zod";
import { createQueueTokens, readAuthUser, type QueueTokens } from "./auth";
import type { ApiEnv } from "./env";
import { trustProxySetting } from "./env";
import { createMetrics, type ApiMetrics } from "./metrics";
import { enforceRateLimits, rateLimitRulesFor } from "./protection";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerEventRoutes } from "./routes/events";
import { registerLoadTestRoutes } from "./routes/loadtest";
import { registerOrderRoutes } from "./routes/orders";
import { registerQueueRoutes } from "./routes/queue";

export interface AppDeps {
  env: ApiEnv;
  ctx: CoreContext;
  events: EventMetaCache;
  metrics: ApiMetrics;
  tokens: QueueTokens;
}

export interface BuiltApp {
  app: FastifyInstance;
  deps: AppDeps;
  close: () => Promise<void>;
}

const fastifyClientError = z.object({ statusCode: z.number().int(), message: z.string() });

const UNLIMITED_PATHS = new Set(["/metrics", "/health", "/payments/webhook"]);

export async function buildApp(
  env: ApiEnv,
  settings: CoreSettings = defaultSettings(),
): Promise<BuiltApp> {
  const prisma = createPrisma(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
  const ctx: CoreContext = { prisma, redis, lua: new LuaScripts(redis), settings };

  const deps: AppDeps = {
    env,
    ctx,
    events: new EventMetaCache(prisma, 5000),
    metrics: createMetrics(prisma),
    tokens: createQueueTokens(env.QUEUE_JWT_SECRET),
  };

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: trustProxySetting(env.TRUST_PROXY),
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ["retry-after"],
  });
  await app.register(jwt, { secret: env.AUTH_JWT_SECRET });

  app.decorateRequest("authUser", null);

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";

    request.authUser = readAuthUser(app, request, path.endsWith("/queue/stream"));

    if (!UNLIMITED_PATHS.has(path)) {
      const route = request.routeOptions.url ?? path;

      const rules = rateLimitRulesFor(
        env,
        request.method,
        route,
        request.ip,
        request.authUser?.sub ?? null,
      );

      await enforceRateLimits(ctx.lua, deps.metrics, rules);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    deps.metrics.httpDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? "unknown",
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .headers(error.headers)
        .send({ code: error.code, message: error.message });
    }

    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const where = issue === undefined ? "" : `${issue.path.join(".")}: `;

      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: `${where}${issue?.message ?? "input tidak valid"}`,
      });
    }

    // Error bawaan Fastify (body JSON rusak, payload terlalu besar, dll.) membawa statusCode 4xx.
    const clientError = fastifyClientError.safeParse(error);

    if (clientError.success && clientError.data.statusCode < 500) {
      return reply
        .status(clientError.data.statusCode)
        .send({ code: "VALIDATION_ERROR", message: clientError.data.message });
    }

    request.log.error({ err: error }, "unhandled error");

    return reply
      .status(500)
      .send({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan di server" });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ code: "NOT_FOUND", message: "Endpoint tidak ditemukan" }),
  );

  app.get("/health", async () => {
    await redis.ping();

    return { ok: true };
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", deps.metrics.registry.contentType);

    return deps.metrics.registry.metrics();
  });

  registerAuthRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerQueueRoutes(app, deps);
  registerOrderRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerLoadTestRoutes(app, deps);

  return {
    app,
    deps,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
    },
  };
}
