import { defineConfig, devices } from "@playwright/test";

/**
 * E2E berjalan terhadap stack yang sudah hidup: API (LOADTEST_MODE=true) di API_URL dan web di WEB_URL.
 * Di CI keduanya dinyalakan oleh workflow sebelum test dijalankan.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
