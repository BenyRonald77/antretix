import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // Semua file berbagi satu Postgres + Redis; dijalankan berurutan agar data antar-test tidak bertabrakan.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Target PRD: coverage >= 70% untuk modul antrean dan inventori.
      include: ["packages/core/src/**", "packages/lua/src/**", "packages/shared/src/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
  },
});
