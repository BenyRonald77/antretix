import type { PrismaClient } from "@antretix/db";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { z } from "zod";

const connectionRows = z.array(z.object({ connections: z.coerce.number().int() }));

export interface ApiMetrics {
  registry: Registry;
  httpDuration: Histogram<"method" | "route" | "status">;
  rateLimited: Counter<"scope">;
  ordersCreated: Counter<"result">;
  queueJoins: Counter<"result">;
  sseConnections: Gauge;
}

export function createMetrics(prisma: PrismaClient): ApiMetrics {
  const registry = new Registry();

  registry.setDefaultLabels({ service: "api", instance: process.env.HOSTNAME ?? "local" });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: "antretix_http_request_duration_seconds",
    help: "Latensi request HTTP per endpoint",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.3, 0.5, 0.8, 1, 2, 5, 10],
    registers: [registry],
  });

  const rateLimited = new Counter({
    name: "antretix_rate_limited_total",
    help: "Request yang ditolak rate limiter (HTTP 429)",
    labelNames: ["scope"],
    registers: [registry],
  });

  const ordersCreated = new Counter({
    name: "antretix_orders_total",
    help: "Hasil percobaan pembuatan order",
    labelNames: ["result"],
    registers: [registry],
  });

  const queueJoins = new Counter({
    name: "antretix_queue_joins_total",
    help: "Hasil join antrean",
    labelNames: ["result"],
    registers: [registry],
  });

  const sseConnections = new Gauge({
    name: "antretix_sse_connections",
    help: "Koneksi SSE antrean yang sedang terbuka di instance ini",
    registers: [registry],
  });

  new Gauge({
    name: "antretix_db_connections",
    help: "Koneksi aktif ke database (pg_stat_activity)",
    registers: [registry],
    async collect() {
      const rows = connectionRows.parse(
        await prisma.$queryRaw`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database()`,
      );

      this.set(rows[0]?.connections ?? 0);
    },
  });

  return { registry, httpDuration, rateLimited, ordersCreated, queueJoins, sseConnections };
}
