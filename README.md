# AntreTix — War Tiket Konser dengan Virtual Queue

Sistem penjualan tiket konser yang tetap stabil saat ribuan orang masuk di detik yang sama.
Pembeli menunggu di **ruang tunggu virtual berbasis Redis** sebelum checkout, server hanya melayani pembeli dalam jumlah
terkendali, dan **tiket tidak pernah terjual melebihi kuota**. Klaim itu dibuktikan dengan test integrasi dan load test k6.

> Dokumen kebutuhan: [PRD — War Tiket Konser dengan Virtual Queue.md](./PRD%20—%20War%20Tiket%20Konser%20dengan%20Virtual%20Queue.md) ·
> Identitas visual: [DESIGN.md](./DESIGN.md)

<!-- HASIL_LOAD_TEST -->

## Cara kerja

```
k6 / pembeli ─► Nginx (rate limit kasar) ─┬─► Next.js (web)
                                          └─► API Fastify #1, #2 ─┬─► Redis 7  (antrean, stok, rate limit)
                                                                   └─► PostgreSQL 16 (order, tiket, kuota: sumber kebenaran)
Worker ×2 (leader lock) ─► admission tiap 1 detik, expiry order, pembersih heartbeat, rekonsiliasi stok
Prometheus ◄─ /metrics API & worker, k6 remote write ─► Grafana
```

| Tahap | Penjaga | Letak kode |
| --- | --- | --- |
| Ruang tunggu (pre-queue) | Skor acak `[0,1)` di sorted set: urutan diundi saat jam buka, posisi tidak dibocorkan selama `PREQUEUE` | [join.lua](packages/lua/scripts/join.lua), [queue.ts](packages/core/src/queue.ts) |
| Antrean | Setelah buka, skor = timestamp ms (selalu di belakang peserta undian, FIFO). `ZADD NX`: refresh/tab baru tidak mengubah posisi | [join.lua](packages/lua/scripts/join.lua) |
| Admission | Satu leader (`SET NX PX`) memindahkan `min(laju, maks_aktif − aktif, sisa_stok)` orang per detik ke sesi aktif | [admit.lua](packages/lua/scripts/admit.lua), [jobs.ts](apps/worker/src/jobs.ts) |
| Checkout | JWT antrean (TTL 10 menit, terikat `userId` + `eventId`) wajib di header `X-Queue-Token` | [auth.ts](apps/api/src/auth.ts) |
| Anti-oversell lapis 1 | `reserve.lua`: cek stok + batas 4 tiket/akun lalu kurangi, atomik | [reserve.lua](packages/lua/scripts/reserve.lua) |
| Anti-oversell lapis 2 | `UPDATE … WHERE sold + reserved + qty <= quota` + `CHECK (sold + reserved <= quota)` + advisory lock per akun, dalam fungsi PostgreSQL | [orders.ts](packages/core/src/orders.ts), [order_functions](packages/db/prisma/migrations/20260925010000_order_functions/migration.sql) |
| Hold & expiry | Order `PENDING` 10 menit; job tiap 30 detik mengubahnya ke `EXPIRED` dan mengembalikan stok **tepat sekali** (transisi bersyarat) | [orders.ts](packages/core/src/orders.ts) |
| Pembayaran | Mock provider memanggil webhook ber-HMAC; webhook ulang idempoten; bayar setelah kedaluwarsa → `REFUNDED` | [payments.ts](packages/core/src/payments.ts) |
| Sold out | Stok Redis 0 dan PostgreSQL mencatat seluruh kuota terjual → status `SOLD_OUT`, semua yang mengantre langsung menerima 410 | [jobs.ts](apps/worker/src/jobs.ts) |
| Rate limit | Sliding window log, semua aturan satu request dicek dalam **satu** panggilan Lua: global 120/menit/IP, join 5/menit per IP + per akun, status 30/menit, checkout 10/menit | [ratelimit.lua](packages/lua/scripts/ratelimit.lua), [protection.ts](apps/api/src/protection.ts) |
| Anti-bot | Cloudflare Turnstile saat join (diverifikasi di server), satu akun = satu posisi, IP pendaftar dicatat untuk ditinjau admin | [protection.ts](apps/api/src/protection.ts) |
| Rekonsiliasi | Tiap menit membandingkan `quota − sold − reserved` dengan stok Redis; selisih yang menetap 3 putaran dikoreksi dengan delta | [reconcile.ts](packages/core/src/reconcile.ts) |

Status antrean dikirim lewat **SSE** (tiap 2 detik, sekaligus heartbeat). Bila koneksi putus, klien beralih ke polling
5 detik dan menampilkan "menyambung ulang". Anggota antrean tanpa kabar lebih dari 2 menit dikeluarkan.

ETA = posisi ÷ laju admit aktual 60 detik terakhir, ditampilkan sebagai rentang ("sekitar 4–6 menit").

## Struktur repo

```
apps/
  api/        Fastify + Zod + @fastify/jwt, endpoint publik, checkout, admin, webhook, /metrics
  worker/     admission leader, sinkron jadwal event, expiry, pembersih heartbeat, rekonsiliasi
  web/        Next.js 15 + Tailwind 4 (halaman pembeli + admin live), Playwright E2E
packages/
  lua/        join, status, admit, reserve, release, ratelimit, cleanup, leader (+ pembungkus bertipe)
  core/       logika domain bersama API & worker (order, pembayaran, antrean, admin, rekonsiliasi)
  db/         skema Prisma, migrasi SQL (termasuk CHECK constraint), seed event demo
  shared/     konstanta, skema Zod (input & respons), ETA, kebijakan batas tiket
tests/integration/   Vitest + Testcontainers (PostgreSQL & Redis asli)
loadtest/            6 skenario k6 + hasil ringkas (results/*.json)
infra/               Docker Compose, Dockerfile multi-target, nginx.conf, Prometheus, dashboard Grafana
tools/oxlint/        plugin lint anti-slop (vendored)
```

## Menjalankan

Prasyarat: Node 22+, pnpm 10, Docker.

### Mode pengembangan

```bash
pnpm install
cp .env.example .env            # sudah berisi test key Turnstile dan secret dev
pnpm infra:up                   # PostgreSQL + Redis
pnpm db:migrate && pnpm db:seed # event demo: Festival 3.000, Tribun 1.500, VIP 500
pnpm dev                        # API :4000, worker, web :3000
```

Buka http://localhost:3000. Akun contoh:

| Peran | Email | Password |
| --- | --- | --- |
| Pembeli | `fan@antretix.dev` | `fan12345` |
| Admin | `admin@antretix.dev` | `admin12345` |

Seed menjadwalkan ruang tunggu langsung dibuka dan penjualan 3 menit kemudian
(`SEED_SALE_OFFSET_MIN` untuk mengubahnya). Admin dapat mengubah jadwal, laju admission, dan menjeda antrean
di **Admin → Pantau live**.

### Stack lengkap (Docker Compose)

```bash
cd infra
docker compose --profile app up -d --build
```

| Layanan | URL |
| --- | --- |
| Aplikasi (nginx → web + 2 API) | http://localhost:8080 |
| Grafana (dashboard "AntreTix: War Tiket") | http://localhost:3001 |
| Prometheus | http://localhost:9090 |

## Pengujian

```bash
pnpm lint            # oxlint + aturan anti-slop
pnpm format:check    # prettier
pnpm typecheck
pnpm test:unit
pnpm test:integration   # butuh Docker (Testcontainers)
pnpm test:coverage      # ambang 70%
pnpm test:e2e           # butuh API (LOADTEST_MODE=true) di :4000 dan web di :3000
```

| Level | Yang dibuktikan |
| --- | --- |
| Unit | ETA, batas tiket per akun, transisi status order, jadwal antrean, signature webhook |
| Integration | 1.000 `reserve.lua` serentak pada stok 100 → tepat 100 sukses · 300 pembeli vs 50 tiket lewat Redis + PostgreSQL → tepat 50 order · PostgreSQL tetap menolak oversell walau stok Redis salah · join ulang tidak mengubah posisi · pre-queue diundi lalu FIFO · checkout tanpa token → 401, token akun lain → 401 · order kedaluwarsa mengembalikan stok tepat sekali walau job berjalan dua kali serentak · webhook palsu ditolak, webhook ulang idempoten, bayar setelah kedaluwarsa → refund · rate limit 429 + `Retry-After` · rekonsiliasi hanya mengoreksi selisih yang menetap |
| E2E (Playwright) | Daftar → ruang tunggu → diundi → checkout → bayar mock → e-ticket QR; halaman checkout tanpa token antrean ditolak |

## Load test

Semua skenario memakai profil PRD sebagai default dan bisa dikecilkan lewat variabel:

```bash
cd infra && docker compose --env-file loadtest.env --profile app up -d --build && cd ..
./loadtest/run.sh no-queue       VUS=2000
./loadtest/run.sh spike-join     VUS=5000
./loadtest/run.sh e2e-queue      VUS=5000 QTY=1
./loadtest/run.sh oversubscribe  USERS=20000 VUS=5000
./loadtest/run.sh bot-attack
./loadtest/run.sh soak           VUS=500 DURATION=30m
```

`loadtest.env` mengaktifkan `LOADTEST_MODE` (endpoint reset event, pembuatan akun massal, dan jalur checkout
tanpa antrean untuk skenario 1), melewati Turnstile, dan mempercayai `X-Forwarded-For` agar setiap VU tampil
sebagai IP berbeda. **Jangan pakai file ini di produksi.**

## Keputusan desain dan penyimpangan dari PRD

- **Reservasi, pembayaran, dan pelepasan order dijalankan sebagai fungsi PostgreSQL** (`antretix_reserve_order`,
  `antretix_pay_order`, `antretix_release_order`, di [migrasi order_functions](packages/db/prisma/migrations/20260925010000_order_functions/migration.sql)).
  Isinya tetap sama dengan PRD: advisory lock per akun, `UPDATE … WHERE sold + reserved + qty <= quota`, dan CHECK constraint.
  Alasannya ditemukan saat load test. Tiga baris `TicketCategory` diperebutkan semua pembeli. Dengan transaksi interaktif Prisma,
  jeda antara `UPDATE` dan `COMMIT` mencakup round-trip ke Node.js, dan saat event loop API sibuk kunci baris ikut tertahan lebih
  lama. `pg_stat_activity` menunjukkan sebagian besar sesi menunggu `Lock:transactionid`. Setelah dipindah ke satu statement,
  p95 order turun dari 6,5–7,4 detik menjadi 1,24 detik pada skenario yang sama.
- **Semua aturan rate limit satu request dicek dalam satu panggilan Lua** di hook `onRequest`, bukan 2–3 panggilan berurutan.
  Request yang ditolak tidak ikut menghabiskan kuota aturan lain.
- **Webhook mock provider diulang dengan backoff** (0,3–16 detik) bila server membalas selain 2xx, seperti penyedia pembayaran
  sungguhan, dan dikirim lewat nginx agar tersebar ke kedua instance API.
- **Status `SOLD_OUT` hanya ditetapkan dari PostgreSQL** (`sold == quota`). Stok Redis yang sesaat kosong, misalnya saat key dibuat
  ulang, tidak lagi bisa menutup antrean.
- **Heartbeat** disimpan sebagai satu sorted set `hb:{event}` (skor = waktu heartbeat terakhir), bukan satu key
  `hb:{event}:{user}` per pengguna, supaya pembersih cukup memanggil `ZRANGEBYSCORE` alih-alih memindai ribuan key.
- **Sold out** tidak langsung ditetapkan saat stok Redis 0. Tiket yang ditahan tapi tidak dibayar akan kembali,
  jadi antrean baru ditutup bila seluruh kuota sudah terjual (tidak ada lagi yang ditahan). Selama itu pengguna melihat
  pesan bahwa semua tiket sedang ditahan.
- **Laju admission** juga dibatasi oleh sisa stok, agar tidak memasukkan ratusan orang ke checkout untuk 3 tiket terakhir.
- **Login** memakai email + password (scrypt). Login Google belum dibuat. Kontraknya satu akun = satu posisi antrean,
  dan itu sudah dijamin.
- **Pembayaran** memakai mock provider dengan signature HMAC yang meniru pola Midtrans. Integrasi Midtrans sandbox
  cukup mengganti pembuatan transaksi dan verifikasi signature di `packages/core/src/payments.ts`.
- **Lint** memakai oxlint + plugin anti-slop (bukan ESLint) dan Prettier.
- **Komponen UI** ditulis sendiri dengan Tailwind 4 mengikuti [DESIGN.md](./DESIGN.md), bukan dari generator shadcn/ui.
- **Checkout** memilih satu kategori per order. Batas 4 tiket berlaku lintas semua order akun di event yang sama.

## Yang belum dikerjakan

- Deploy demo publik (Railway/Fly.io + Neon) belum dilakukan karena butuh akun dan kredensial pemilik repo.
  Image Docker dan Compose sudah siap dipakai.
- Video demo.
- Login Google (OAuth) dan integrasi Midtrans sandbox sungguhan.
