// Menghasilkan infra/grafana/dashboards/antretix.json. Jalankan: node infra/grafana/build-dashboard.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const ds = { type: "prometheus", uid: "prometheus" };

let nextId = 1;

function panel(title, description, targets, gridPos, unit = "short", extra = {}) {
  return {
    id: nextId++,
    type: "timeseries",
    title,
    description,
    datasource: ds,
    gridPos,
    fieldConfig: {
      defaults: {
        unit,
        custom: { lineWidth: 2, fillOpacity: 0, showPoints: "never" },
        color: { mode: "palette-classic" },
      },
      overrides: [],
    },
    options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi" } },
    targets: targets.map(([expr, legendFormat], index) => ({
      refId: String.fromCharCode(65 + index),
      datasource: ds,
      expr,
      legendFormat,
    })),
    ...extra,
  };
}

function row(title, y) {
  return {
    id: nextId++,
    type: "row",
    title,
    collapsed: false,
    gridPos: { h: 1, w: 24, x: 0, y },
    panels: [],
  };
}

const w = 12;

const h = 8;

const panels = [
  row("Antrean: apakah lonjakan tertahan di Redis?", 0),
  panel(
    "Panjang antrean vs pengguna aktif",
    "Antrean menyerap lonjakan; pengguna aktif tidak boleh melewati batas maks. aktif.",
    [
      ["max by (event) (antretix_queue_length)", "antrean {{event}}"],
      ["max by (event) (antretix_active_users)", "aktif {{event}}"],
    ],
    { h, w, x: 0, y: 1 },
  ),
  panel(
    "Laju admission (orang/detik)",
    "Jumlah pengguna yang dimasukkan worker ke checkout per detik.",
    [["sum by (event) (rate(antretix_admitted_total[30s]))", "{{event}}"]],
    { h, w, x: w, y: 1 },
  ),
  row("Inventori: nol oversell", 9),
  panel(
    "Sisa stok Redis per kategori",
    "Harus turun ke 0 dan tidak pernah negatif.",
    [["max by (category) (antretix_stock_remaining)", "{{category}}"]],
    { h, w, x: 0, y: 10 },
  ),
  panel(
    "Selisih rekonsiliasi Redis vs PostgreSQL",
    "0 = sinkron. Nilai non-nol yang menetap dikoreksi otomatis setelah 3 putaran.",
    [["max by (category) (antretix_reconcile_diff)", "{{category}}"]],
    { h, w, x: w, y: 10 },
  ),
  row("API: latensi dan penolakan", 18),
  panel(
    "Latensi p95 per endpoint",
    "Target: join < 300 ms, status < 150 ms, checkout < 800 ms.",
    [
      [
        'histogram_quantile(0.95, sum by (le, route) (rate(antretix_http_request_duration_seconds_bucket{route!="/metrics"}[1m])))',
        "{{route}}",
      ],
    ],
    { h, w, x: 0, y: 19 },
    "s",
  ),
  panel(
    "Request per detik menurut status HTTP",
    "Lonjakan 5xx berarti sistem kewalahan; 429 berarti rate limiter bekerja.",
    [
      [
        'sum by (status) (rate(antretix_http_request_duration_seconds_count{route!="/metrics"}[30s]))',
        "{{status}}",
      ],
    ],
    { h, w, x: w, y: 19 },
    "reqps",
  ),
  panel(
    "Ditolak rate limiter per scope",
    "Request yang dijawab 429 per detik.",
    [["sum by (scope) (rate(antretix_rate_limited_total[30s]))", "{{scope}}"]],
    { h, w, x: 0, y: 27 },
    "reqps",
  ),
  panel(
    "Koneksi database",
    "Tidak boleh melewati pool yang dikonfigurasi (2 instance API × connection_limit + worker).",
    [["max(antretix_db_connections)", "koneksi aktif"]],
    { h, w, x: w, y: 27 },
  ),
  row("Order dan beban uji (k6)", 35),
  panel(
    "Order per detik menurut hasil",
    "CREATED = hold berhasil; OUT_OF_STOCK / LIMIT_EXCEEDED = ditolak dengan rapi.",
    [["sum by (result) (rate(antretix_orders_total[30s]))", "{{result}}"]],
    { h, w, x: 0, y: 36 },
    "reqps",
  ),
  panel(
    "k6: virtual users dan p95 http_req_duration",
    "Terisi hanya saat k6 dijalankan dengan output Prometheus remote write.",
    [
      ["max(k6_vus)", "VU"],
      ["max(k6_http_req_duration_p95) * 1000", "p95 (ms)"],
    ],
    { h, w, x: w, y: 36 },
  ),
  panel(
    "SSE terbuka per instance API",
    "Koneksi server-sent events yang sedang aktif.",
    [["sum by (instance) (antretix_sse_connections)", "{{instance}}"]],
    { h, w, x: 0, y: 44 },
  ),
  panel(
    "Memori proses (RSS)",
    "Uji soak: garis harus datar, bukan naik terus.",
    [["max by (service, instance) (process_resident_memory_bytes)", "{{service}} {{instance}}"]],
    { h, w, x: w, y: 44 },
    "bytes",
  ),
];

const dashboard = {
  uid: "antretix",
  title: "AntreTix: War Tiket",
  tags: ["antretix"],
  timezone: "browser",
  schemaVersion: 39,
  version: 1,
  refresh: "5s",
  time: { from: "now-15m", to: "now" },
  panels,
};

const out = join(here, "dashboards", "antretix.json");

mkdirSync(dirname(out), { recursive: true });

writeFileSync(out, `${JSON.stringify(dashboard, null, 2)}\n`);

console.log(`Dashboard ditulis ke ${out}`);
