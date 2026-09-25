import { createServer, type Server } from "node:http";
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";

export interface WorkerMetrics {
  registry: Registry;
  admitted: Counter<"event">;
  queueLength: Gauge<"event">;
  activeUsers: Gauge<"event">;
  stock: Gauge<"event" | "category">;
  expiredOrders: Counter;
  droppedByHeartbeat: Counter<"event">;
  reconcileDiff: Gauge<"event" | "category">;
  isLeader: Gauge<"event">;
}

export function createWorkerMetrics(instanceId: string): WorkerMetrics {
  const registry = new Registry();

  registry.setDefaultLabels({ service: "worker", worker: instanceId });
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    admitted: new Counter({
      name: "antretix_admitted_total",
      help: "Pengguna yang di-admit ke checkout",
      labelNames: ["event"],
      registers: [registry],
    }),
    queueLength: new Gauge({
      name: "antretix_queue_length",
      help: "Panjang antrean",
      labelNames: ["event"],
      registers: [registry],
    }),
    activeUsers: new Gauge({
      name: "antretix_active_users",
      help: "Pengguna aktif di checkout",
      labelNames: ["event"],
      registers: [registry],
    }),
    stock: new Gauge({
      name: "antretix_stock_remaining",
      help: "Sisa stok di Redis",
      labelNames: ["event", "category"],
      registers: [registry],
    }),
    expiredOrders: new Counter({
      name: "antretix_orders_expired_total",
      help: "Order PENDING yang kedaluwarsa",
      registers: [registry],
    }),
    droppedByHeartbeat: new Counter({
      name: "antretix_queue_dropped_total",
      help: "Anggota antrean yang dikeluarkan karena tidak ada heartbeat",
      labelNames: ["event"],
      registers: [registry],
    }),
    reconcileDiff: new Gauge({
      name: "antretix_reconcile_diff",
      help: "Selisih stok Redis dikurangi (quota - sold - reserved) di PostgreSQL",
      labelNames: ["event", "category"],
      registers: [registry],
    }),
    isLeader: new Gauge({
      name: "antretix_admission_leader",
      help: "1 bila instance ini leader admission event",
      labelNames: ["event"],
      registers: [registry],
    }),
  };
}

export function serveMetrics(registry: Registry, port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/metrics") {
      response
        .writeHead(request.url === "/health" ? 200 : 404)
        .end(request.url === "/health" ? "ok" : "");

      return;
    }

    registry
      .metrics()
      .then((body) => response.writeHead(200, { "content-type": registry.contentType }).end(body))
      .catch(() => response.writeHead(500).end());
  });

  server.listen(port, "0.0.0.0");

  return server;
}
