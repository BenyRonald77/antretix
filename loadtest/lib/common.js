// Utilitas bersama untuk semua skenario k6 AntreTix.
import http from "k6/http";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:8080/api";

export const EVENT_ID = __ENV.EVENT_ID || "demo-konser";

const AUTH_SECRET = __ENV.AUTH_JWT_SECRET || "dev-auth-secret-ganti-di-produksi-0123456789";

const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || "admin@antretix.dev";

const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || "admin12345";

export const outcomes = new Counter("flow_outcomes");

/**
 * k6 hanya menyimpan sub-metrik bertag bila dirujuk threshold. Threshold "count>=0" selalu lolos;
 * gunanya agar rincian hasil akhir setiap pembeli ikut tercatat di ringkasan.
 */
export const OUTCOME_THRESHOLDS = Object.fromEntries(
  ["PAID", "SOLD_OUT", "OUT_OF_STOCK", "LIMIT_EXCEEDED", "TIMEOUT", "PAY_TIMEOUT", "ABANDONED"].map(
    (outcome) => [`flow_outcomes{outcome:${outcome}}`, ["count>=0"]],
  ),
);

export const waitTime = new Trend("queue_wait_ms", true);

export const gracefulRejection = new Rate("graceful_rejection");

function b64url(text) {
  return encoding.b64encode(text, "rawurl");
}

/**
 * Menandatangani JWT login sendiri (HS256) untuk akun yang sudah dibuat lewat /loadtest/users.
 * Jauh lebih ringan daripada ribuan request login, jadi beban yang diukur benar-benar beban antrean.
 */
export function signUserToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

  const payload = b64url(
    JSON.stringify({
      sub: userId,
      email: `${userId}@loadtest.dev`,
      name: userId,
      role: "CUSTOMER",
      iat: now,
      exp: now + 86400,
    }),
  );

  const signature = crypto.hmac("sha256", AUTH_SECRET, `${header}.${payload}`, "base64rawurl");

  return `${header}.${payload}.${signature}`;
}

/** IP palsu yang unik per pengguna, dikirim lewat X-Forwarded-For (API dijalankan dengan TRUST_PROXY=true). */
export function fakeIp(index) {
  const n = index + 1;

  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export function userHeaders(token, ip, extra) {
  return Object.assign(
    { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": ip },
    extra || {},
  );
}

function parse(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

export function adminToken() {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    {
      headers: { "content-type": "application/json", "x-forwarded-for": "10.255.255.1" },
    },
  );

  if (response.status !== 200) {
    throw new Error(`login admin gagal: ${response.status} ${response.body}`);
  }

  return response.json("token");
}

function adminHeaders(token) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-forwarded-for": "10.255.255.1",
  };
}

export function createUsers(token, prefix, count) {
  const response = http.post(`${BASE_URL}/loadtest/users`, JSON.stringify({ prefix, count }), {
    headers: adminHeaders(token),
    timeout: "300s",
  });

  if (response.status !== 200) {
    throw new Error(`gagal membuat user: ${response.status} ${response.body}`);
  }
}

export function resetEvent(token, eventId, schedule) {
  const response = http.post(
    `${BASE_URL}/admin/events/${eventId}/reset`,
    JSON.stringify(schedule),
    {
      headers: adminHeaders(token),
      timeout: "120s",
    },
  );

  if (response.status !== 200) {
    throw new Error(`reset event gagal: ${response.status} ${response.body}`);
  }
}

export function createEvent(token, input) {
  const response = http.post(`${BASE_URL}/admin/events`, JSON.stringify(input), {
    headers: adminHeaders(token),
  });

  if (response.status !== 201) {
    throw new Error(`gagal membuat event: ${response.status} ${response.body}`);
  }

  return response.json("id");
}

export function adminMetrics(token, eventId) {
  return http
    .get(`${BASE_URL}/admin/events/${eventId}/metrics`, { headers: adminHeaders(token) })
    .json();
}

export function redisInfo(token) {
  return http.get(`${BASE_URL}/loadtest/redis-info`, { headers: adminHeaders(token) }).json();
}

/** Menunggu status antrean berubah menjadi OPEN (worker menyinkronkan jadwal setiap beberapa detik). */
export function waitForOpen(eventId, timeoutSec) {
  for (let elapsed = 0; elapsed < timeoutSec; elapsed += 1) {
    const response = http.get(`${BASE_URL}/events/${eventId}`, {
      headers: { "x-forwarded-for": "10.255.255.2" },
    });

    if (response.status === 200 && response.json("queueStatus") === "OPEN") {
      return;
    }

    sleep(1);
  }

  throw new Error(`event ${eventId} tidak kunjung OPEN`);
}

export function join(eventId, token, ip) {
  return http.post(`${BASE_URL}/events/${eventId}/queue`, "{}", {
    headers: userHeaders(token, ip),
    tags: { name: "join" },
  });
}

export function status(eventId, token, ip) {
  return http.get(`${BASE_URL}/events/${eventId}/queue/status`, {
    headers: userHeaders(token, ip),
    tags: { name: "status" },
  });
}

/**
 * Menunggu giliran: polling status sampai ADMITTED (kembalikan token antrean), atau berhenti bila SOLD_OUT.
 * Return { state, token }.
 */
export function waitForAdmission(eventId, token, ip, pollSec, maxWaitSec) {
  const started = Date.now();

  while ((Date.now() - started) / 1000 < maxWaitSec) {
    const response = status(eventId, token, ip);
    const body = parse(response);

    if (response.status === 410) {
      return { state: "SOLD_OUT", token: null };
    }

    if (body !== null && body.state !== undefined) {
      if (body.state.state === "ADMITTED") {
        waitTime.add(Date.now() - started);

        return { state: "ADMITTED", token: body.state.token };
      }

      if (body.state.state === "SOLD_OUT") {
        return { state: "SOLD_OUT", token: null };
      }

      if (body.state.state === "NOT_IN_QUEUE") {
        // Terlempar (mis. heartbeat) atau sesi habis: coba masuk lagi.
        join(eventId, token, ip);
      }
    }

    sleep(pollSec);
  }

  return { state: "TIMEOUT", token: null };
}

function randomKey() {
  return `k6-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Memilih kategori yang stoknya cukup lalu membuat order; mencoba kategori lain bila kalah cepat. */
export function placeOrder(eventId, token, ip, queueToken, qty) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stock = http.get(`${BASE_URL}/events/${eventId}/stock`, {
      headers: userHeaders(token, ip, { "x-queue-token": queueToken }),
      tags: { name: "stock" },
    });

    const body = parse(stock);

    if (stock.status !== 200 || body === null) {
      return { outcome: `STOCK_${stock.status}` };
    }

    const candidates = body.categories.filter((category) => category.remaining >= qty);

    if (candidates.length === 0) {
      return { outcome: "OUT_OF_STOCK" };
    }

    const category = candidates[Math.floor(Math.random() * candidates.length)];

    const response = http.post(
      `${BASE_URL}/events/${eventId}/orders`,
      JSON.stringify({ categoryId: category.id, qty }),
      {
        headers: userHeaders(token, ip, {
          "x-queue-token": queueToken,
          "idempotency-key": randomKey(),
        }),
        tags: { name: "order" },
      },
    );

    if (response.status === 201 || response.status === 200) {
      return { outcome: "ORDERED", orderId: response.json("order.id") };
    }

    const code = parse(response) === null ? `HTTP_${response.status}` : response.json("code");

    if (code !== "OUT_OF_STOCK") {
      return { outcome: code };
    }
  }

  return { outcome: "OUT_OF_STOCK" };
}

/** Membayar lewat mock provider lalu menunggu webhook menandai order PAID. */
export function payOrder(orderId, token, ip) {
  const pay = http.post(
    `${BASE_URL}/orders/${orderId}/pay`,
    JSON.stringify({ outcome: "success" }),
    {
      headers: userHeaders(token, ip),
      tags: { name: "pay" },
    },
  );

  if (pay.status !== 202) {
    return `PAY_${pay.status}`;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    sleep(1);

    const order = http.get(`${BASE_URL}/orders/${orderId}`, {
      headers: userHeaders(token, ip),
      tags: { name: "order_status" },
    });

    if (order.status === 200 && order.json("order.status") === "PAID") {
      return "PAID";
    }
  }

  return "PAY_TIMEOUT";
}

/** Alur lengkap satu pembeli: join, tunggu giliran, pesan, bayar. Mengembalikan hasil akhirnya. */
export function purchaseFlow(eventId, userIndex, prefix, options) {
  const token = signUserToken(`lt-${prefix}-${userIndex}`);
  const ip = fakeIp(userIndex);
  const joined = join(eventId, token, ip);

  if (joined.status === 410) {
    return "SOLD_OUT";
  }

  if (joined.status !== 202 && joined.status !== 200) {
    return `JOIN_${joined.status}`;
  }

  const admission = waitForAdmission(eventId, token, ip, options.pollSec, options.maxWaitSec);

  if (admission.state !== "ADMITTED") {
    return admission.state;
  }

  const order = placeOrder(eventId, token, ip, admission.token, options.qty);

  if (order.outcome !== "ORDERED") {
    // Gagal memesan: lepaskan slot checkout agar orang berikutnya bisa masuk.
    http.del(`${BASE_URL}/events/${eventId}/queue`, null, {
      headers: userHeaders(token, ip),
      tags: { name: "leave" },
    });

    return order.outcome;
  }

  return payOrder(order.orderId, token, ip);
}

export function recordOutcome(outcome) {
  outcomes.add(1, { outcome });
  gracefulRejection.add(outcome === "SOLD_OUT" || outcome === "OUT_OF_STOCK");
}

/** Ringkasan bisnis dari metrik admin: total terjual/ditahan per kategori dan pengecekan oversell. */
export function inventoryReport(token, eventId) {
  const metrics = adminMetrics(token, eventId);
  let quota = 0;
  let sold = 0;
  let reserved = 0;
  let oversoldCategories = 0;

  for (const category of metrics.categories) {
    quota += category.quota;
    sold += category.sold;
    reserved += category.reserved;

    if (category.sold + category.reserved > category.quota || category.redisStock < 0) {
      oversoldCategories += 1;
    }
  }

  return {
    quota,
    sold,
    reserved,
    oversoldCategories,
    categories: metrics.categories,
    queueStatus: metrics.queueStatus,
  };
}

const KEPT_METRICS = [
  "http_reqs",
  "http_req_failed",
  "http_req_duration",
  "http_req_duration{name:join}",
  "http_req_duration{name:status}",
  "http_req_duration{name:order}",
  "http_req_duration{name:naive_order}",
  "http_req_duration{name:stock}",
  "http_req_failed{name:join}",
  "http_req_failed{name:status}",
  "http_req_failed{name:naive_order}",
  "queue_wait_ms",
  "graceful_rejection",
  "flow_outcomes",
  "tickets_sold",
  "tickets_reserved",
  "tickets_quota",
  "oversold_categories",
  "redis_keys_before",
  "redis_keys_after",
  "normal_join_ok",
  "naive_system_error",
  "naive_sold_out",
  "bot_blocked",
  "checks",
  "vus_max",
  "iterations",
];

/** Menyimpan ringkasan ringkas ke loadtest/results/<nama>.json dan mencetak ringkasan teks. */
export function summaryWriter(name) {
  return function handleSummary(data) {
    const metrics = {};

    for (const key of KEPT_METRICS) {
      if (data.metrics[key] !== undefined) {
        metrics[key] = data.metrics[key].values;
      }
    }

    for (const key of Object.keys(data.metrics)) {
      if (key.indexOf("flow_outcomes{") === 0) {
        metrics[key] = data.metrics[key].values;
      }
    }

    const result = {
      scenario: name,
      finishedAt: new Date().toISOString(),
      config: {
        vus: __ENV.VUS || null,
        users: __ENV.USERS || null,
        duration: __ENV.DURATION || null,
        qty: __ENV.QTY || null,
        machine: __ENV.MACHINE || null,
      },
      thresholds: Object.fromEntries(
        Object.entries(data.metrics)
          .filter(([, metric]) => metric.thresholds !== undefined)
          .map(([key, metric]) => [key, metric.thresholds]),
      ),
      metrics,
    };

    return {
      [`/scripts/results/${name}${__ENV.LABEL ? `-${__ENV.LABEL}` : ""}.json`]: JSON.stringify(
        result,
        null,
        2,
      ),
      stdout: textSummary(data, { indent: " ", enableColors: false }),
    };
  };
}
