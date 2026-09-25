// Skenario 6 — SOAK.
// VUS pembeli konstan (default 500) selama DURATION (default 30 menit) pada event berkuota sangat besar.
// Setiap iterasi adalah pembeli baru: sebagian membayar, sebagian meninggalkan pesanan (dilepas job expiry).
// Membuktikan: tidak ada kebocoran memori (lihat panel RSS di Grafana) dan key Redis tidak menumpuk tanpa batas.
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import http from "k6/http";
import {
  BASE_URL,
  adminToken,
  createEvent,
  createUsers,
  fakeIp,
  join,
  payOrder,
  placeOrder,
  recordOutcome,
  redisInfo,
  signUserToken,
  summaryWriter,
  userHeaders,
  waitForAdmission,
  waitForOpen,
  OUTCOME_THRESHOLDS,
} from "../lib/common.js";

const VUS = Number(__ENV.VUS || 500);

const USER_POOL = Number(__ENV.USERS || 50000);

const PREFIX = "s6";

const keysBefore = new Gauge("redis_keys_before");

const keysAfter = new Gauge("redis_keys_after");

export const options = {
  scenarios: {
    soak: {
      executor: "constant-vus",
      vus: VUS,
      duration: __ENV.DURATION || "30m",
    },
  },
  thresholds: {
    ...OUTCOME_THRESHOLDS,
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();
  const now = Date.now();

  createUsers(token, PREFIX, USER_POOL);

  const eventId = createEvent(token, {
    name: `Soak ${new Date(now).toISOString()}`,
    venue: "Load test",
    startsAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    saleOpensAt: new Date(now - 1000).toISOString(),
    preQueueAt: new Date(now - 60000).toISOString(),
    admitPerSec: 100,
    maxActive: 1000,
    categories: [{ name: "Reguler", price: 100000, quota: 1000000 }],
  });

  waitForOpen(eventId, 60);

  const before = redisInfo(token);

  keysBefore.add(before.keys);

  return { token, eventId };
}

export default function (data) {
  const userIndex = exec.scenario.iterationInTest % USER_POOL;
  const token = signUserToken(`lt-${PREFIX}-${userIndex}`);
  const ip = fakeIp(userIndex);

  join(data.eventId, token, ip);

  const admission = waitForAdmission(data.eventId, token, ip, 3, 300);

  if (admission.state !== "ADMITTED") {
    recordOutcome(admission.state);

    return;
  }

  const order = placeOrder(data.eventId, token, ip, admission.token, 1);

  if (order.outcome !== "ORDERED") {
    recordOutcome(order.outcome);

    return;
  }

  // 70% membayar, 30% meninggalkan pesanan (dibatalkan) agar jalur pengembalian stok ikut teruji.
  if (Math.random() < 0.7) {
    recordOutcome(payOrder(order.orderId, token, ip));
  } else {
    http.post(`${BASE_URL}/orders/${order.orderId}/cancel`, "{}", {
      headers: userHeaders(token, ip),
      tags: { name: "cancel" },
    });
    http.del(`${BASE_URL}/events/${data.eventId}/queue`, null, {
      headers: userHeaders(token, ip),
      tags: { name: "leave" },
    });
    recordOutcome("ABANDONED");
  }
}

export function teardown(data) {
  const after = redisInfo(data.token);

  keysAfter.add(after.keys);
  console.log(`redis setelah soak: ${JSON.stringify(after)}`);
}

export const handleSummary = summaryWriter("6-soak");
