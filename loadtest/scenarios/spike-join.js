// Skenario 2 — SPIKE JOIN ANTREAN.
// 0 → VUS (default 5.000) masuk antrean dalam 10 detik, lalu setiap pengguna memeriksa status tiap 5 detik.
// Membuktikan Redis menyerap lonjakan: error < 1%, p95 join < 300 ms, p95 status < 150 ms.
import { check, sleep } from "k6";
import {
  EVENT_ID,
  adminToken,
  createUsers,
  fakeIp,
  join,
  resetEvent,
  signUserToken,
  status,
  summaryWriter,
  waitForOpen,
} from "../lib/common.js";

const VUS = Number(__ENV.VUS || 5000);

const PREFIX = "s2";

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: VUS },
        { duration: __ENV.HOLD || "50s", target: VUS },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    "http_req_failed{name:join}": ["rate<0.01"],
    "http_req_failed{name:status}": ["rate<0.01"],
    "http_req_duration{name:join}": ["p(95)<300"],
    "http_req_duration{name:status}": ["p(95)<150"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();

  createUsers(token, PREFIX, VUS);
  // Admission dimatikan praktis (1/detik) agar hampir semua VU tetap di antrean dan terus polling.
  resetEvent(token, EVENT_ID, { preQueueInSec: 0, saleOpensInSec: 0, admitPerSec: 1 });
  waitForOpen(EVENT_ID, 30);

  return {};
}

export default function () {
  const userIndex = __VU - 1;
  const token = signUserToken(`lt-${PREFIX}-${userIndex}`);
  const ip = fakeIp(userIndex);

  if (__ITER === 0) {
    const response = join(EVENT_ID, token, ip);

    check(response, {
      "join diterima (202/200)": (res) => res.status === 202 || res.status === 200,
    });
    sleep(5);

    return;
  }

  const response = status(EVENT_ID, token, ip);

  check(response, { "status 200": (res) => res.status === 200 });
  sleep(5);
}

export const handleSummary = summaryWriter("2-spike-join");
