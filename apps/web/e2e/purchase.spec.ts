import { expect, test, type Page } from "@playwright/test";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const EVENT_ID = "demo-konser";

const SHOTS = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS !== undefined) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }
}

async function loginToken(email: string, password: string): Promise<string> {
  const login = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = await login.json();

  expect(body).toHaveProperty("token");

  return String(body.token);
}

/** Reset event demo lewat API admin (hanya tersedia di LOADTEST_MODE) agar test mulai dari kondisi bersih. */
async function resetEvent(saleOpensInSec: number) {
  const token = await loginToken("admin@antretix.dev", "admin12345");

  const reset = await fetch(`${API_URL}/admin/events/${EVENT_ID}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ preQueueInSec: 0, saleOpensInSec }),
  });

  expect(reset.ok).toBe(true);
}

test("ruang tunggu → antrean → checkout → bayar mock → e-ticket", async ({ page }) => {
  await resetEvent(20);

  const email = `e2e-${Date.now()}@antretix.dev`;

  await page.goto("/login");
  await page.getByRole("button", { name: "Belum punya akun? Daftar" }).click();
  await page.getByLabel("Nama").fill("Pembeli E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("rahasia-e2e-123");
  await shot(page, "01-register");
  await page.getByRole("button", { name: "Daftar" }).click();
  await expect(page.getByRole("button", { name: /Keluar/ })).toBeVisible();

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Kategori tiket" })).toBeVisible();

  // Turnstile memakai test site key Cloudflare yang selalu lolos.
  const join = page.getByRole("button", { name: "Masuk Ruang Tunggu" });

  await expect(join).toBeEnabled();
  await shot(page, "02-event");
  await join.click();

  await expect(page).toHaveURL(/\/waiting$/);
  await expect(page.getByRole("heading", { name: "Anda sudah di ruang tunggu" })).toBeVisible();
  await shot(page, "03-waiting");

  // Saat penjualan dibuka pengguna diundi, di-admit worker, lalu diarahkan ke checkout.
  await expect(page).toHaveURL(/\/checkout$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Pilih tiket" })).toBeVisible();
  await page.getByText("VIP", { exact: true }).click();
  await page.getByLabel("Jumlah").selectOption("2");
  await shot(page, "04-checkout");
  await page.getByRole("button", { name: "Tahan tiket & lanjut bayar" }).click();

  await expect(page).toHaveURL(/\/pay$/);
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
  await shot(page, "05-pay");
  await page.getByRole("button", { name: "Bayar sekarang" }).click();

  await expect(page).toHaveURL(/\/orders\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByAltText(/QR tiket VIP/)).toHaveCount(2);
  await shot(page, "06-eticket");
});

test("halaman checkout tanpa token antrean tidak bisa dipakai", async ({ page }) => {
  const token = await loginToken("fan@antretix.dev", "fan12345");

  await page.goto("/");
  await page.evaluate((value) => window.localStorage.setItem("antretix.token", value), token);
  await page.goto(`/events/${EVENT_ID}/checkout`);
  await expect(page.getByRole("heading", { name: "Sesi checkout tidak ditemukan" })).toBeVisible();

  // API juga menolak langsung, bukan hanya UI.
  const response = await fetch(`${API_URL}/events/${EVENT_ID}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "idempotency-key": `e2e-no-token-${Date.now()}`,
    },
    body: JSON.stringify({ categoryId: "demo-vip", qty: 1 }),
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "QUEUE_TOKEN_REQUIRED" });
});
