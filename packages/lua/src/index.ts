import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Redis } from "ioredis";
import { z } from "zod";
import { keys } from "@antretix/shared";

const SCRIPT_NAMES = [
  "join",
  "status",
  "admit",
  "reserve",
  "release",
  "ratelimit",
  "cleanup",
  "leader",
] as const;

type ScriptName = (typeof SCRIPT_NAMES)[number];

interface LoadedScript {
  source: string;
  sha: string;
}

function loadScript(name: ScriptName): LoadedScript {
  const source = readFileSync(new URL(`../scripts/${name}.lua`, import.meta.url), "utf8");

  return { source, sha: createHash("sha1").update(source).digest("hex") };
}

const SCRIPTS = new Map(SCRIPT_NAMES.map((name) => [name, loadScript(name)]));

export function scriptSource(name: ScriptName): string {
  const script = SCRIPTS.get(name);

  if (script === undefined) {
    throw new Error(`Lua script ${name} tidak ditemukan`);
  }

  return script.source;
}

// Balasan Redis diparse di sini, satu kali, menjadi tipe domain.
const intReply = z.coerce.number().int();

const joinReply = z.tuple([
  z.enum(["QUEUED", "PREQUEUE", "ADMITTED", "SOLD_OUT", "CLOSED", "NOT_OPEN"]),
  intReply,
  intReply,
]);

const statusReply = z.tuple([
  z.string(),
  intReply,
  intReply,
  intReply,
  intReply,
  intReply,
  intReply,
  intReply,
]);

const admitReply = z.tuple([intReply, intReply, z.string(), intReply]);

const rateLimitReply = z.tuple([intReply, intReply]);

export interface RateLimitCheck {
  key: string;
  windowMs: number;
  limit: number;
}

export interface RateLimitResult {
  blockedIndex: number;
  retryAfterMs: number;
}

export type JoinCode = z.infer<typeof joinReply>[0];

export interface JoinResult {
  code: JoinCode;
  rank: number;
  added: boolean;
}

export interface StatusSnapshot {
  queueStatus: string;
  admittedPttlMs: number;
  activeExpiresAt: number;
  rank: number;
  total: number;
  admitsInWindow: number;
  admitPerSec: number;
  stockTotal: number;
}

export interface AdmitResult {
  admitted: number;
  active: number;
  reason: string;
  stockTotal: number;
}

export interface EventScope {
  id: string;
  stockKeys: readonly string[];
}

/**
 * Pembungkus bertipe untuk semua Lua script. Script dipanggil lewat EVALSHA;
 * bila Redis belum mengenal script-nya (NOSCRIPT, misal setelah restart), dipanggil ulang lewat EVAL.
 */
export class LuaScripts {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private async run(
    name: ScriptName,
    scriptKeys: readonly string[],
    args: readonly (string | number)[],
  ) {
    const script = SCRIPTS.get(name);

    if (script === undefined) {
      throw new Error(`Lua script ${name} tidak ditemukan`);
    }

    try {
      return await this.redis.evalsha(script.sha, scriptKeys.length, ...scriptKeys, ...args);
    } catch (error) {
      if (error instanceof Error && error.message.includes("NOSCRIPT")) {
        return this.redis.eval(script.source, scriptKeys.length, ...scriptKeys, ...args);
      }

      throw error;
    }
  }

  async join(
    eventId: string,
    userId: string,
    nowMs: number,
    randomScore: number,
  ): Promise<JoinResult> {
    const reply = joinReply.parse(
      await this.run(
        "join",
        [
          keys.queue(eventId),
          keys.status(eventId),
          keys.heartbeat(eventId),
          keys.admitted(eventId, userId),
          keys.active(eventId),
        ],
        [userId, nowMs, randomScore],
      ),
    );

    return { code: reply[0], rank: reply[1], added: reply[2] === 1 };
  }

  async status(
    scope: EventScope,
    userId: string,
    nowMs: number,
    windowMs: number,
  ): Promise<StatusSnapshot> {
    const eventId = scope.id;

    const reply = statusReply.parse(
      await this.run(
        "status",
        [
          keys.queue(eventId),
          keys.status(eventId),
          keys.heartbeat(eventId),
          keys.admitted(eventId, userId),
          keys.active(eventId),
          keys.admitStats(eventId),
          keys.config(eventId),
          ...scope.stockKeys,
        ],
        [userId, nowMs, windowMs],
      ),
    );

    return {
      queueStatus: reply[0],
      admittedPttlMs: reply[1],
      activeExpiresAt: reply[2],
      rank: reply[3],
      total: reply[4],
      admitsInWindow: reply[5],
      admitPerSec: reply[6],
      stockTotal: reply[7],
    };
  }

  async admit(
    scope: EventScope,
    nowMs: number,
    limits: { admitPerSec: number; maxActive: number; sessionTtlMs: number },
  ): Promise<AdmitResult> {
    const eventId = scope.id;

    const reply = admitReply.parse(
      await this.run(
        "admit",
        [
          keys.queue(eventId),
          keys.active(eventId),
          keys.status(eventId),
          keys.heartbeat(eventId),
          keys.admitStats(eventId),
          ...scope.stockKeys,
        ],
        [nowMs, limits.admitPerSec, limits.maxActive, limits.sessionTtlMs, eventId],
      ),
    );

    return { admitted: reply[0], active: reply[1], reason: reply[2], stockTotal: reply[3] };
  }

  /** Return sisa stok (>= 0), -1 stok habis, -2 melebihi batas per akun, -3 stok belum diinisialisasi. */
  async reserve(
    eventId: string,
    categoryId: string,
    userId: string,
    qty: number,
    maxPerUser: number,
  ): Promise<number> {
    return intReply.parse(
      await this.run(
        "reserve",
        [keys.stock(eventId, categoryId), keys.bought(eventId, userId)],
        [qty, maxPerUser],
      ),
    );
  }

  async release(eventId: string, categoryId: string, userId: string, qty: number): Promise<number> {
    return intReply.parse(
      await this.run(
        "release",
        [keys.stock(eventId, categoryId), keys.bought(eventId, userId)],
        [qty],
      ),
    );
  }

  /**
   * Mengecek beberapa aturan rate limit dalam satu panggilan atomik.
   * `blockedIndex` = indeks aturan (0-based) yang memblokir, atau -1 bila lolos.
   */
  async rateLimit(
    rules: readonly RateLimitCheck[],
    nowMs: number,
    member: string,
  ): Promise<RateLimitResult> {
    const args: (string | number)[] = [nowMs, member];

    for (const rule of rules) {
      args.push(rule.windowMs, rule.limit);
    }

    const reply = rateLimitReply.parse(
      await this.run(
        "ratelimit",
        rules.map((rule) => rule.key),
        args,
      ),
    );

    return { blockedIndex: reply[0] - 1, retryAfterMs: reply[1] };
  }

  async cleanup(eventId: string, cutoffMs: number, batch: number): Promise<number> {
    return intReply.parse(
      await this.run("cleanup", [keys.queue(eventId), keys.heartbeat(eventId)], [cutoffMs, batch]),
    );
  }

  async acquireLeader(lockKey: string, instanceId: string, ttlMs: number): Promise<boolean> {
    return intReply.parse(await this.run("leader", [lockKey], [instanceId, ttlMs])) === 1;
  }
}
