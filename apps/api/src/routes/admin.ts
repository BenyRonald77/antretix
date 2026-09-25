import { controlQueue, getAdminMetrics, suspiciousSignupIps, upsertEvent } from "@antretix/core";
import { AppError, eventInputSchema, queueControlSchema } from "@antretix/shared";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app";
import { requireAdmin } from "../auth";
import { eventParams } from "./events";

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { ctx } = deps;

  app.get("/admin/events", async (request) => {
    requireAdmin(request);

    const events = await ctx.prisma.event.findMany({
      orderBy: { saleOpensAt: "desc" },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });

    return { events };
  });

  app.get("/admin/events/:id", async (request) => {
    requireAdmin(request);

    const { id } = eventParams.parse(request.params);

    const event = await ctx.prisma.event.findUnique({
      where: { id },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });

    if (event === null) {
      throw new AppError("NOT_FOUND", "Event tidak ditemukan");
    }

    return { event };
  });

  app.post("/admin/events", async (request, reply) => {
    requireAdmin(request);

    const input = eventInputSchema.parse(request.body);
    const eventId = await upsertEvent(ctx, input);

    deps.events.invalidate(eventId);

    return reply.status(input.id === undefined ? 201 : 200).send({ id: eventId });
  });

  app.patch("/admin/events/:id/queue", async (request) => {
    requireAdmin(request);

    const { id } = eventParams.parse(request.params);
    const control = queueControlSchema.parse(request.body);
    const queueStatus = await controlQueue(ctx, id, control);

    if (queueStatus === null) {
      throw new AppError("NOT_FOUND", "Event tidak ditemukan");
    }

    deps.events.invalidate(id);

    return { queueStatus };
  });

  app.get("/admin/events/:id/metrics", async (request) => {
    requireAdmin(request);

    const { id } = eventParams.parse(request.params);
    const metrics = await getAdminMetrics(ctx, id);

    if (metrics === null) {
      throw new AppError("NOT_FOUND", "Event tidak ditemukan");
    }

    return metrics;
  });

  app.get("/admin/suspicious-ips", async (request) => {
    requireAdmin(request);

    return { ips: await suspiciousSignupIps(ctx, 3) };
  });
}
