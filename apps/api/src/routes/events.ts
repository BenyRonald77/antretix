import { readQueueStatus, scheduledQueueStatus, type EventMeta } from "@antretix/core";
import { AppError, keys, type CategoryView, type EventView } from "@antretix/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireQueueToken, requireUser } from "../auth";

export const eventParams = z.object({ id: z.string().min(1).max(64) });

export async function requireEvent(deps: AppDeps, eventId: string): Promise<EventMeta> {
  const meta = await deps.events.get(eventId);

  if (meta === null || meta.status === "DRAFT") {
    throw new AppError("NOT_FOUND", "Event tidak ditemukan");
  }

  return meta;
}

async function categoryViews(deps: AppDeps, meta: EventMeta): Promise<CategoryView[]> {
  const stocks = meta.stockKeys.length > 0 ? await deps.ctx.redis.mget(...meta.stockKeys) : [];

  return meta.categories.map((category, index) => {
    const raw = stocks[index];

    // Stok Redis belum ada (event belum disinkronkan worker): pakai angka dari DB.
    const remaining =
      raw === null || raw === undefined
        ? category.quota - category.sold - category.reserved
        : Number(raw);

    return {
      id: category.id,
      name: category.name,
      price: category.price,
      quota: category.quota,
      remaining: Math.max(0, remaining),
    };
  });
}

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/events", async () => {
    const events = await deps.ctx.prisma.event.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { saleOpensAt: "asc" },
      select: {
        id: true,
        name: true,
        venue: true,
        startsAt: true,
        saleOpensAt: true,
        status: true,
        posterUrl: true,
      },
      take: 50,
    });

    return { events, serverTime: new Date().toISOString() };
  });

  app.get("/events/:id", async (request) => {
    const { id } = eventParams.parse(request.params);
    const meta = await requireEvent(deps, id);

    const queueStatus =
      (await readQueueStatus(deps.ctx, id)) ?? scheduledQueueStatus(meta, new Date());

    const view: EventView = {
      id: meta.id,
      name: meta.name,
      venue: meta.venue,
      description: meta.description,
      posterUrl: meta.posterUrl,
      startsAt: meta.startsAt.toISOString(),
      saleOpensAt: meta.saleOpensAt.toISOString(),
      preQueueAt: meta.preQueueAt.toISOString(),
      status: meta.status,
      queueStatus,
      maxPerUser: meta.maxPerUser,
      serverTime: new Date().toISOString(),
      categories: await categoryViews(deps, meta),
    };

    return view;
  });

  app.get("/events/:id/stock", async (request) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);
    const meta = await requireEvent(deps, id);
    const claims = requireQueueToken(deps.tokens, request, id, user.sub);
    const bought = Number((await deps.ctx.redis.get(keys.bought(id, user.sub))) ?? "0");

    return {
      categories: await categoryViews(deps, meta),
      sessionExpiresAt: new Date(claims.expiresAtMs).toISOString(),
      maxPerUser: meta.maxPerUser,
      alreadyHeld: bought,
    };
  });
}
