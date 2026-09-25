import type { OutgoingHttpHeaders } from "node:http";
import { getQueueState, leaveQueue } from "@antretix/core";
import { AppError, joinQueueSchema, type QueueState } from "@antretix/shared";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app";
import { requireUser, type AuthUser } from "../auth";
import { verifyTurnstile } from "../protection";
import { eventParams, requireEvent } from "./events";

function isFinalState(state: QueueState): boolean {
  return state.state === "ADMITTED" || state.state === "SOLD_OUT" || state.state === "NOT_IN_QUEUE";
}

export function registerQueueRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { ctx, env, metrics } = deps;

  async function stateFor(eventId: string, user: AuthUser): Promise<QueueState> {
    const meta = await requireEvent(deps, eventId);

    return getQueueState(ctx, meta, user.sub, deps.tokens.sign);
  }

  app.post("/events/:id/queue", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);
    const input = joinQueueSchema.parse(request.body ?? {});

    // Rate limit join (per IP + per user) sudah diterapkan di hook onRequest.
    await verifyTurnstile(
      { secret: env.TURNSTILE_SECRET, bypass: env.TURNSTILE_BYPASS },
      input.turnstileToken,
      request.ip,
    );

    const meta = await requireEvent(deps, id);
    // Skor acak dipakai hanya selama PREQUEUE: semua yang datang sebelum jam buka punya peluang yang sama.
    const result = await ctx.lua.join(meta.id, user.sub, Date.now(), Math.random());

    metrics.queueJoins.inc({ result: result.code });

    switch (result.code) {
      case "SOLD_OUT":
        throw new AppError("SOLD_OUT", "Tiket event ini sudah habis");
      case "CLOSED":
      case "NOT_OPEN":
        throw new AppError(
          "QUEUE_NOT_OPEN",
          "Ruang tunggu belum dibuka atau penjualan sudah ditutup",
        );
      case "ADMITTED":
        return reply.status(200).send({
          code: "ADMITTED",
          state: await getQueueState(ctx, meta, user.sub, deps.tokens.sign),
        });
      case "PREQUEUE":
      case "QUEUED":
        return reply.status(202).send({
          code: "QUEUED",
          state: await getQueueState(ctx, meta, user.sub, deps.tokens.sign),
        });
    }
  });

  app.get("/events/:id/queue/status", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);

    const state = await stateFor(id, user);

    if (state.state === "SOLD_OUT") {
      return reply
        .status(410)
        .send({ code: "SOLD_OUT", message: "Tiket event ini sudah habis", state });
    }

    return reply.status(200).send({ code: state.state, state });
  });

  /**
   * SSE: server mendorong status setiap SSE_INTERVAL_MS. Setiap push sekaligus menjadi heartbeat.
   * Koneksi ditutup begitu pengguna di-admit, tiket habis, atau pengguna tidak lagi di antrean;
   * klien yang kehilangan koneksi beralih ke polling.
   */
  app.get("/events/:id/queue/stream", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);

    await requireEvent(deps, id);

    const origin = request.headers.origin;
    const allowedOrigins = env.CORS_ORIGIN.split(",").map((value) => value.trim());

    const headers: OutgoingHttpHeaders = {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    };

    if (origin !== undefined && allowedOrigins.includes(origin)) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-credentials"] = "true";
    }

    reply.hijack();

    const raw = reply.raw;
    let closed = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(timer);
      metrics.sseConnections.dec();
      raw.end();
    };

    const push = async () => {
      if (closed) {
        return;
      }

      const state = await stateFor(id, user);

      if (closed) {
        return;
      }

      raw.write(`event: status\ndata: ${JSON.stringify(state)}\n\n`);

      if (isFinalState(state)) {
        finish();
      }
    };

    raw.writeHead(200, headers);
    raw.write("retry: 3000\n\n");
    metrics.sseConnections.inc();
    request.raw.on("close", finish);

    timer = setInterval(() => {
      push().catch((error: Error) => {
        request.log.warn({ err: error }, "SSE push gagal");
        finish();
      });
    }, env.SSE_INTERVAL_MS);

    await push().catch((error: Error) => {
      request.log.warn({ err: error }, "SSE push awal gagal");
      finish();
    });
  });

  app.delete("/events/:id/queue", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);

    await leaveQueue(ctx, id, user.sub);

    return reply.status(200).send({ code: "LEFT" });
  });
}
