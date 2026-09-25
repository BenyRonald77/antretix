// Skenario 1 — PEMBANDING TANPA ANTREAN.
// 0 → VUS (default 2.000) dalam 10 detik langsung menembak endpoint order yang menulis ke PostgreSQL,
// tanpa ruang tunggu dan tanpa penyaring Redis. Tujuannya mendokumentasikan kegagalan: pool koneksi DB habis,
// latensi melonjak, dan request timeout.
import http from "k6/http";
import { check } from "k6";
import { Gauge, Rate } from "k6/metrics";
import {
  BASE_URL,
  EVENT_ID,
  adminToken,
  createUsers,
  fakeIp,
  inventoryReport,
  resetEvent,
  signUserToken,
  summaryWriter,
  userHeaders,
  waitForOpen,
} from "../lib/common.js";

const VUS = Number(__ENV.VUS || 2000);

const USERS_PER_VU = 20;

const PREFIX = "s1";

const CATEGORIES = ["demo-festival", "demo-tribun", "demo-vip"];

const sold = new Gauge("tickets_sold");

const reserved = new Gauge("tickets_reserved");

const oversold = new Gauge("oversold_categories");

// Membedakan kegagalan sistem (timeout, 5xx) dari penolakan wajar (409 stok habis).
const systemError = new Rate("naive_system_error");

const soldOut = new Rate("naive_sold_out");

export const options = {
  scenarios: {
    naive: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: VUS },
        { duration: __ENV.HOLD || "30s", target: VUS },
      ],
      gracefulRampDown: "10s",
    },
  },
  // Threshold memakai target PRD untuk checkout, agar terlihat jelas bahwa sistem tanpa antrean tidak memenuhinya.
  thresholds: {
    "http_req_duration{name:naive_order}": ["p(95)<800"],
    naive_system_error: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();

  createUsers(token, PREFIX, VUS * USERS_PER_VU);
  resetEvent(token, EVENT_ID, { preQueueInSec: 0, saleOpensInSec: 0 });
  waitForOpen(EVENT_ID, 30);

  return { token };
}

export default function () {
  const userIndex = ((__VU - 1) * USERS_PER_VU + __ITER) % (VUS * USERS_PER_VU);
  const token = signUserToken(`lt-${PREFIX}-${userIndex}`);
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  const response = http.post(
    `${BASE_URL}/loadtest/events/${EVENT_ID}/naive-orders`,
    JSON.stringify({ categoryId: category, qty: 1 }),
    {
      headers: userHeaders(token, fakeIp(userIndex), {
        "idempotency-key": `s1-${__VU}-${__ITER}-${Date.now()}`,
      }),
      tags: { name: "naive_order" },
      timeout: "30s",
    },
  );

  check(response, { "order dibuat (201)": (res) => res.status === 201 });
  systemError.add(response.status === 0 || response.status >= 500);
  soldOut.add(response.status === 409);
}

export function teardown(data) {
  const report = inventoryReport(data.token, EVENT_ID);

  sold.add(report.sold);
  reserved.add(report.reserved);
  oversold.add(report.oversoldCategories);
}

export const handleSummary = summaryWriter("1-no-queue");
