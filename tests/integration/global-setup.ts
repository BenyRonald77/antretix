import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

let postgres: StartedPostgreSqlContainer | undefined;

let redis: StartedRedisContainer | undefined;

/** Menyalakan PostgreSQL dan Redis asli (Testcontainers), lalu menjalankan migrasi Prisma. */
export async function setup(project: TestProject): Promise<void> {
  [postgres, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine")
      .withCommand(["postgres", "-c", "max_connections=300"])
      .start(),
    new RedisContainer("redis:7-alpine").start(),
  ]);

  const databaseUrl = `${postgres.getConnectionUri()}?connection_limit=40&pool_timeout=30`;
  const root = path.resolve(import.meta.dirname, "../..");

  execFileSync("pnpm", ["--filter", "@antretix/db", "exec", "prisma", "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), redis?.stop()]);
}
