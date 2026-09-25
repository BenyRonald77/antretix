// Skenario 5 — SERANGAN BOT.
// 50 VU bot mengirim total 100 request/detik ke endpoint join dari beberapa akun dan IP saja,
// sementara pengguna normal (satu akun, satu IP, satu kali join) masuk bersamaan.
// Membuktikan: rate limiter memblokir bot, pengguna normal tidak terdampak.
import { check } from "k6";
import { Rate } from "k6/metrics";
import {
  EVENT_ID,
  adminToken,
  createUsers,
  fakeIp,
  join,
  resetEvent,
  signUserToken,
  summaryWriter,
  waitForOpen,
} from "../lib/common.js";

const NORMAL_USERS = Number(__ENV.NORMAL_USERS || 300);

const BOT_ACCOUNTS = 5;

const normalJoinOk = new Rate("normal_join_ok");

const botBlocked = new Rate("bot_blocked");

export const options = {
  scenarios: {
    bots: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 50,
      maxVUs: 50,
      exec: "bot",
    },
    normal: {
      executor: "per-vu-iterations",
      vus: NORMAL_USERS,
      iterations: 1,
      startTime: "10s",
      maxDuration: "60s",
      exec: "normal",
    },
  },
  thresholds: {
    normal_join_ok: ["rate==1"],
    bot_blocked: ["rate>0.95"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

export function setup() {
  const token = adminToken();

  createUsers(token, "s5b", BOT_ACCOUNTS);
  createUsers(token, "s5n", NORMAL_USERS);
  resetEvent(token, EVENT_ID, { preQueueInSec: 0, saleOpensInSec: 0 });
  waitForOpen(EVENT_ID, 30);

  return {};
}

export function bot() {
  const account = Math.floor(Math.random() * BOT_ACCOUNTS);
  // Bot memakai 5 akun dan 5 IP (blok 172.16.x.x) berulang-ulang.
  const response = join(EVENT_ID, signUserToken(`lt-s5b-${account}`), `172.16.0.${account + 1}`);

  botBlocked.add(response.status === 429);
}

export function normal() {
  const index = __VU - 1;
  const response = join(EVENT_ID, signUserToken(`lt-s5n-${index}`), fakeIp(100000 + index));

  const ok = check(response, {
    "pengguna normal diterima": (res) => res.status === 202 || res.status === 200,
  });

  normalJoinOk.add(ok);
}

export const handleSummary = summaryWriter("5-bot-attack");
