// Skenario 4 — OVERSUBSCRIBE.
// USERS pembeli (default 20.000) berebut 5.000 tiket. VUS menentukan berapa pembeli yang aktif bersamaan
// (default = USERS; kecilkan di mesin terbatas: setiap VU lalu melayani beberapa pembeli berturut-turut).
// Membuktikan: tepat sebanyak kuota yang terjual, sisanya menerima SOLD_OUT / OUT_OF_STOCK dengan rapi.
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import {
  EVENT_ID,
  adminToken,
  createUsers,
  inventoryReport,
  purchaseFlow,
  recordOutcome,
  resetEvent,
  summaryWriter,
  waitForOpen,
  OUTCOME_THRESHOLDS,
} from "../lib/common.js";

const USERS = Number(__ENV.USERS || 20000);

const VUS = Number(__ENV.VUS || USERS);

const QTY = Number(__ENV.QTY || 1);

const PREFIX = "s4";

const sold = new Gauge("tickets_sold");

const reserved = new Gauge("tickets_reserved");

const quota = new Gauge("tickets_quota");

const oversold = new Gauge("oversold_categories");

export const options = {
  scenarios: {
    crowd: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: USERS,
      maxDuration: __ENV.MAX_DURATION || "30m",
    },
  },
  thresholds: {
    ...OUTCOME_THRESHOLDS,
    oversold_categories: ["value==0"],
    // Setiap pembeli harus berakhir dengan hasil yang jelas (terbayar atau ditolak dengan rapi), bukan error.
    "flow_outcomes{outcome:TIMEOUT}": ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();

  createUsers(token, PREFIX, USERS);
  resetEvent(token, EVENT_ID, { preQueueInSec: 0, saleOpensInSec: 0 });
  waitForOpen(EVENT_ID, 30);

  return { token };
}

export default function () {
  const userIndex = exec.scenario.iterationInTest;

  const outcome = purchaseFlow(EVENT_ID, userIndex, PREFIX, {
    qty: QTY,
    pollSec: 3,
    maxWaitSec: 900,
  });

  recordOutcome(outcome);
}

export function teardown(data) {
  const report = inventoryReport(data.token, EVENT_ID);

  sold.add(report.sold);
  reserved.add(report.reserved);
  quota.add(report.quota);
  oversold.add(report.oversoldCategories);
  console.log(`inventori akhir: ${JSON.stringify(report)}`);
}

export const handleSummary = summaryWriter("4-oversubscribe");
