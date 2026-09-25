import {
  eventStatusFor,
  expireDueOrders,
  loadEventMeta,
  nextQueueStatus,
  reconcileStock,
  readQueueStatus,
  scheduledQueueStatus,
  syncEventToRedis,
  type CoreContext,
  type EventMeta,
} from "@antretix/core";
import { keys } from "@antretix/shared";
import type { WorkerMetrics } from "./metrics";

export interface WorkerIntervals {
  admissionMs: number;
  syncMs: number;
  cleanupMs: number;
  expiryMs: number;
  reconcileMs: number;
}

export const DEFAULT_INTERVALS: WorkerIntervals = {
  admissionMs: 1000,
  syncMs: 5000,
  cleanupMs: 10_000,
  expiryMs: 30_000,
  reconcileMs: 60_000,
};

const LEADER_TTL_MS = 5000;

const SOLD_OUT_CHECK_MS = 3000;

const EXPIRY_BATCH = 500;

const CLEANUP_BATCH = 1000;

type LogLevel = "info" | "warn" | "error";

export type WorkerLogger = (
  level: LogLevel,
  message: string,
  data?: Record<string, string | number | boolean>,
) => void;

export const consoleLogger: WorkerLogger = (level, message, data) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...data });

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
};

/**
 * Worker AntreTix. Beberapa instance boleh berjalan bersamaan:
 * - admission per event hanya dijalankan leader (lock:admission:{event}, SET NX PX, diperpanjang tiap tick),
 * - job periodik (cleanup, expiry, rekonsiliasi) dijaga lock job agar tidak berjalan ganda.
 * Bila leader mati, lock kedaluwarsa dalam 5 detik dan instance lain mengambil alih.
 */
export class Worker {
  private readonly ctx: CoreContext;
  private readonly metrics: WorkerMetrics;
  private readonly instanceId: string;
  private readonly intervals: WorkerIntervals;
  private readonly log: WorkerLogger;
  private readonly events = new Map<string, EventMeta>();
  private readonly lastSoldOutCheck = new Map<string, number>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    ctx: CoreContext,
    metrics: WorkerMetrics,
    instanceId: string,
    intervals: WorkerIntervals,
    log: WorkerLogger,
  ) {
    this.ctx = ctx;
    this.metrics = metrics;
    this.instanceId = instanceId;
    this.intervals = intervals;
    this.log = log;
  }

  async start(): Promise<void> {
    await this.syncEvents();

    this.every("sync", this.intervals.syncMs, () => this.syncEvents());
    this.every("admission", this.intervals.admissionMs, () => this.admissionTick());
    this.every("cleanup", this.intervals.cleanupMs, () =>
      this.withJobLock("cleanup", this.intervals.cleanupMs, () => this.cleanupTick()),
    );
    this.every("expiry", this.intervals.expiryMs, () =>
      this.withJobLock("expiry", this.intervals.expiryMs, () => this.expiryTick()),
    );
    this.every("reconcile", this.intervals.reconcileMs, () =>
      this.withJobLock("reconcile", this.intervals.reconcileMs, () => this.reconcileTick()),
    );

    this.log("info", "worker berjalan", { instanceId: this.instanceId });
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  }

  /** Menjalankan job secara berkala tanpa tumpang tindih: tick baru dilewati bila tick sebelumnya belum selesai. */
  private every(name: string, intervalMs: number, job: () => Promise<void>): void {
    const timer = setInterval(() => {
      if (this.running.has(name)) {
        return;
      }

      this.running.add(name);
      job()
        .catch((error: Error) => this.log("error", `job ${name} gagal`, { error: error.message }))
        .finally(() => this.running.delete(name));
    }, intervalMs);

    this.timers.push(timer);
  }

  private async withJobLock(
    job: string,
    intervalMs: number,
    run: () => Promise<void>,
  ): Promise<void> {
    if (await this.ctx.lua.acquireLeader(keys.jobLock(job), this.instanceId, intervalMs * 2)) {
      await run();
    }
  }

  async syncEvents(): Promise<void> {
    const rows = await this.ctx.prisma.event.findMany({
      where: { status: { in: ["SCHEDULED", "ON_SALE", "SOLD_OUT"] } },
      select: { id: true },
    });

    const seen = new Set<string>();

    for (const row of rows) {
      const meta = await loadEventMeta(this.ctx.prisma, row.id);

      if (meta === null) {
        continue;
      }

      seen.add(meta.id);
      this.events.set(meta.id, meta);

      const queueStatus = await syncEventToRedis(this.ctx, meta, new Date());
      const eventStatus = eventStatusFor(queueStatus, meta.status);

      if (eventStatus !== meta.status) {
        await this.ctx.prisma.event.update({
          where: { id: meta.id },
          data: { status: eventStatus },
        });
        this.log("info", "status event berubah", {
          eventId: meta.id,
          from: meta.status,
          to: eventStatus,
        });
      }
    }

    for (const eventId of this.events.keys()) {
      if (!seen.has(eventId)) {
        this.events.delete(eventId);
      }
    }
  }

  async admissionTick(): Promise<void> {
    for (const meta of this.events.values()) {
      await this.admitEvent(meta);
    }
  }

  private async admitEvent(meta: EventMeta): Promise<void> {
    const isLeader = await this.ctx.lua.acquireLeader(
      keys.admissionLock(meta.id),
      this.instanceId,
      LEADER_TTL_MS,
    );

    this.metrics.isLeader.set({ event: meta.id }, isLeader ? 1 : 0);

    if (!isLeader) {
      return;
    }

    // Transisi jadwal (PREQUEUE -> OPEN) dicek setiap tick agar penjualan dibuka tepat waktu.
    const current = await readQueueStatus(this.ctx, meta.id);
    const next = nextQueueStatus(current, scheduledQueueStatus(meta, new Date()));

    if (current !== null && next !== current) {
      // Jadwal di cache bisa basi (misal baru diubah admin): pastikan dengan data terbaru sebelum mengubah status.
      const fresh = await loadEventMeta(this.ctx.prisma, meta.id);

      const confirmed =
        fresh === null
          ? current
          : nextQueueStatus(current, scheduledQueueStatus(fresh, new Date()));

      if (fresh !== null) {
        this.events.set(fresh.id, fresh);
      }

      if (confirmed !== current) {
        await this.ctx.redis.set(keys.status(meta.id), confirmed);
        this.log("info", "status antrean berubah", {
          eventId: meta.id,
          from: current,
          to: confirmed,
        });
      }
    }

    // Konfigurasi dibaca dari Redis setiap tick agar perubahan admin langsung berlaku.
    const [admitPerSec, maxActive] = await this.ctx.redis.hmget(
      keys.config(meta.id),
      "admitPerSec",
      "maxActive",
    );

    const result = await this.ctx.lua.admit(meta, Date.now(), {
      admitPerSec: Number(admitPerSec ?? meta.admitPerSec),
      maxActive: Number(maxActive ?? meta.maxActive),
      sessionTtlMs: this.ctx.settings.sessionTtlMs,
    });

    if (result.admitted > 0) {
      this.metrics.admitted.inc({ event: meta.id }, result.admitted);
    }

    this.metrics.activeUsers.set({ event: meta.id }, result.active);
    this.metrics.queueLength.set(
      { event: meta.id },
      await this.ctx.redis.zcard(keys.queue(meta.id)),
    );

    const stocks = meta.stockKeys.length > 0 ? await this.ctx.redis.mget(...meta.stockKeys) : [];

    for (const [index, category] of meta.categories.entries()) {
      this.metrics.stock.set(
        { event: meta.id, category: category.name },
        Number(stocks[index] ?? "0"),
      );
    }

    if (result.stockTotal <= 0) {
      await this.checkSoldOut(meta);
    }
  }

  /**
   * Stok Redis 0 belum tentu habis final: order PENDING yang tidak dibayar akan mengembalikan stok.
   * Antrean ditutup (SOLD_OUT) hanya bila stok 0 DAN tidak ada lagi order PENDING.
   */
  private async checkSoldOut(meta: EventMeta): Promise<void> {
    const now = Date.now();

    if (now - (this.lastSoldOutCheck.get(meta.id) ?? 0) < SOLD_OUT_CHECK_MS) {
      return;
    }

    this.lastSoldOutCheck.set(meta.id, now);

    const status = await readQueueStatus(this.ctx, meta.id);

    if (status !== "OPEN" && status !== "PAUSED") {
      return;
    }

    // Keputusan final diambil dari PostgreSQL (sumber kebenaran), bukan dari stok Redis yang bisa
    // sesaat kosong (mis. key sedang dibuat ulang). Habis = seluruh kuota sudah terjual (tidak ada yang ditahan).
    const totals = await this.ctx.prisma.ticketCategory.aggregate({
      where: { eventId: meta.id },
      _sum: { quota: true, sold: true },
    });

    if ((totals._sum.sold ?? 0) < (totals._sum.quota ?? 0)) {
      return;
    }

    await this.ctx.redis.set(keys.status(meta.id), "SOLD_OUT");
    await this.ctx.prisma.event.update({ where: { id: meta.id }, data: { status: "SOLD_OUT" } });
    this.log("info", "event sold out, antrean ditutup", {
      eventId: meta.id,
      queueLength: await this.ctx.redis.zcard(keys.queue(meta.id)),
    });
  }

  async cleanupTick(): Promise<void> {
    const cutoff = Date.now() - this.ctx.settings.heartbeatTimeoutMs;

    for (const meta of this.events.values()) {
      let removed = 0;
      let batch = 0;

      do {
        batch = await this.ctx.lua.cleanup(meta.id, cutoff, CLEANUP_BATCH);
        removed += batch;
      } while (batch === CLEANUP_BATCH);

      if (removed > 0) {
        this.metrics.droppedByHeartbeat.inc({ event: meta.id }, removed);
        this.log("info", "anggota antrean tanpa heartbeat dikeluarkan", {
          eventId: meta.id,
          removed,
        });
      }
    }
  }

  async expiryTick(): Promise<void> {
    let total = 0;
    let batch = 0;

    do {
      batch = await expireDueOrders(this.ctx, EXPIRY_BATCH);
      total += batch;
    } while (batch === EXPIRY_BATCH);

    if (total > 0) {
      this.metrics.expiredOrders.inc(total);
      this.log("info", "order kedaluwarsa, stok dikembalikan", { released: total });
    }
  }

  async reconcileTick(): Promise<void> {
    for (const meta of this.events.values()) {
      const rows = await reconcileStock(this.ctx, meta.id);

      for (const row of rows) {
        this.metrics.reconcileDiff.set(
          { event: row.eventId, category: row.categoryName },
          row.diff,
        );

        if (row.diff !== 0) {
          this.log(row.healed ? "warn" : "info", "selisih stok Redis vs PostgreSQL", {
            eventId: row.eventId,
            category: row.categoryName,
            dbAvailable: row.dbAvailable,
            redisStock: row.redisStock,
            diff: row.diff,
            healed: row.healed,
          });
        }
      }
    }
  }
}
