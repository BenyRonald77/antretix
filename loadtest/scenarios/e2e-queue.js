// Skenario 3 — END-TO-END DENGAN ANTREAN.
// VUS pembeli (default 5.000, masing-masing QTY tiket, default 1) melewati alur penuh:
// join → tunggu admit → pesan → bayar mock. Stok 5.000.
// Membuktikan: nol oversell, koneksi DB stabil, semua tiket terjual bila permintaan = stok.
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

const VUS = Number(__ENV.VUS || 5000);

const QTY = Number(__ENV.QTY || 1);

const PREFIX = "s3";

const sold = new Gauge("tickets_sold");

const reserved = new Gauge("tickets_reserved");

const quota = new Gauge("tickets_quota");

const oversold = new Gauge("oversold_categories");

export const options = {
  scenarios: {
    buyers: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: __ENV.MAX_DURATION || "20m",
    },
  },
  thresholds: {
    ...OUTCOME_THRESHOLDS,
    oversold_categories: ["value==0"],
    "http_req_failed{name:join}": ["rate<0.01"],
    "http_req_duration{name:order}": ["p(95)<800"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();

  createUsers(token, PREFIX, VUS);
  resetEvent(token, EVENT_ID, { preQueueInSec: 0, saleOpensInSec: 0 });
  waitForOpen(EVENT_ID, 30);

  return { token };
}

export default function () {
  const userIndex = exec.vu.idInTest - 1;

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

export const handleSummary = summaryWriter("3-e2e-queue");
