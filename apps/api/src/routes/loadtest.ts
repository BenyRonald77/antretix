import { createOrderWithoutQueue, resetEventForLoadTest } from "@antretix/core";
import {
  AppError,
  createOrderSchema,
  DEFAULTS,
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
} from "@antretix/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireAdmin, requireUser } from "../auth";
import { eventParams, requireEvent } from "./events";

const usersBody = z.object({
  prefix: z.string().regex(/^[a-z0-9-]{1,20}$/),
  count: z.number().int().min(1).max(50_000),
});

const resetBody = z.object({
  preQueueInSec: z.number().int().min(0).default(0),
  saleOpensInSec: z.number().int().min(0).default(0),
  // Selalu diisi agar pengaturan skenario sebelumnya tidak terbawa ke skenario berikutnya.
  admitPerSec: z.number().int().positive().default(DEFAULTS.admitPerSec),
  maxActive: z.number().int().positive().default(DEFAULTS.maxActive),
});

const USER_CHUNK = 5000;

/**
 * Endpoint KHUSUS LOAD TEST. Hanya didaftarkan bila LOADTEST_MODE=true, karena bisa menghapus order
 * dan membuka jalur checkout tanpa antrean (untuk skenario pembanding).
 */
export function registerLoadTestRoutes(app: FastifyInstance, deps: AppDeps): void {
  if (!deps.env.LOADTEST_MODE) {
    return;
  }

  const { ctx } = deps;

  app.post("/admin/events/:id/reset", async (request) => {
    requireAdmin(request);

    const { id } = eventParams.parse(request.params);
    const schedule = resetBody.parse(request.body ?? {});

    await resetEventForLoadTest(ctx, id, schedule);
    deps.events.invalidate(id);

    return { code: "RESET" };
  });

  // Membuat banyak akun sekaligus (id deterministik lt-{prefix}-{n}), agar k6 cukup menandatangani JWT sendiri.
  app.post("/loadtest/users", async (request) => {
    requireAdmin(request);

    const { prefix, count } = usersBody.parse(request.body);

    for (let start = 0; start < count; start += USER_CHUNK) {
      const size = Math.min(USER_CHUNK, count - start);

      await ctx.prisma.user.createMany({
        data: Array.from({ length: size }, (_, offset) => {
          const id = `lt-${prefix}-${start + offset}`;

          return { id, email: `${id}@loadtest.dev`, name: id };
        }),
        skipDuplicates: true,
      });
    }

    return { created: count };
  });

  // Skenario 1: checkout langsung ke PostgreSQL tanpa antrean dan tanpa Redis.
  app.post("/loadtest/events/:id/naive-orders", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const user = requireUser(request);
    const input = createOrderSchema.parse(request.body);
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers[IDEMPOTENCY_HEADER]);

    if (!idempotencyKey.success) {
      throw new AppError("VALIDATION_ERROR", "Header Idempotency-Key wajib diisi");
    }

    const meta = await requireEvent(deps, id);

    const order = await createOrderWithoutQueue(ctx, {
      meta,
      userId: user.sub,
      categoryId: input.categoryId,
      qty: input.qty,
      idempotencyKey: idempotencyKey.data,
    });

    return reply.status(201).send({ order });
  });

  app.get("/loadtest/redis-info", async (request) => {
    requireAdmin(request);

    const [keyCount, memory] = await Promise.all([ctx.redis.dbsize(), ctx.redis.info("memory")]);
    const usedMemory = /used_memory:(\d+)/.exec(memory)?.[1] ?? "0";

    return { keys: keyCount, usedMemoryBytes: Number(usedMemory) };
  });
}
