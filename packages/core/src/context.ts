import type { PrismaClient } from "@antretix/db";
import type { LuaScripts } from "@antretix/lua";
import { DEFAULTS } from "@antretix/shared";
import type { Redis } from "ioredis";

export interface CoreSettings {
  /** Lama tiket ditahan untuk pembayaran. */
  holdTtlMs: number;
  /** Lama sesi aktif / access token setelah di-admit. */
  sessionTtlMs: number;
  /** Batas waktu tanpa heartbeat sebelum dikeluarkan dari antrean. */
  heartbeatTimeoutMs: number;
}

/** Dependensi yang dipakai bersama oleh API dan worker. */
export interface CoreContext {
  prisma: PrismaClient;
  redis: Redis;
  lua: LuaScripts;
  settings: CoreSettings;
}

export function defaultSettings(): CoreSettings {
  return {
    holdTtlMs: Number(process.env.HOLD_TTL_SEC ?? DEFAULTS.holdTtlSec) * 1000,
    sessionTtlMs: Number(process.env.SESSION_TTL_SEC ?? DEFAULTS.accessTokenTtlSec) * 1000,
    heartbeatTimeoutMs:
      Number(process.env.HEARTBEAT_TIMEOUT_SEC ?? DEFAULTS.heartbeatTimeoutSec) * 1000,
  };
}
