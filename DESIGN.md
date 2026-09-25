# DESIGN.md — Identitas visual AntreTix

Rujukan untuk siapa pun (manusia atau agent) yang mengubah UI di `apps/web`.

## Arah

AntreTix menjual tiket konser. Motif visualnya diambil dari **tiket kertas fisik**: kertas krem, tinta hitam hangat,
cap merah stempel, dan tepi sobekan berlubang. Tujuannya membuat layar yang dipakai orang saat cemas menunggu
terasa tenang dan jelas, bukan meriah.

## Warna

| Token                             | Terang                     | Gelap                 | Dipakai untuk                                                                |
| --------------------------------- | -------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `--paper`                         | `#f5efe3`                  | `#16140f`             | Latar halaman                                                                |
| `--paper-2`                       | `#ebe3d3`                  | `#221f18`             | Permukaan tiket (stub), hover baris                                          |
| `--ink`                           | `#1d1b17`                  | `#efe8da`             | Teks utama, progress bar, grafik satu seri                                   |
| `--ink-2`                         | `#5b554b`                  | `#aba292`             | Teks sekunder, label sumbu                                                   |
| `--rule`                          | `#cfc5b2`                  | `#3b362c`             | Garis pemisah, border input                                                  |
| `--stamp`                         | `#b8321c`                  | `#e0573d`             | **Satu-satunya aksen**: tombol aksi utama per layar dan nomor antrean        |
| `--ok` / `--warn` / `--danger`    | hijau / kuning tua / merah | versi terang          | Status nyata saja (koneksi, peringatan, error)                               |
| `--series-sold` / `--series-held` | `#b8321c` / `#1f6fa8`      | `#e0573d` / `#3f8fd0` | Grafik stok admin (lolos validator dataviz: lightness, chroma, CVD, kontras) |

Aturan: aksen merah hanya muncul di **satu tempat per layar**. Tidak ada gradien, glow, atau glassmorphism.

## Tipografi

**Archivo** (Google Fonts, sumbu lebar `wdth`). Dipilih karena bernuansa poster konser dan angkanya tegas untuk
nomor antrean serta hitung mundur. Judul memakai `font-stretch` 112–125%. Angka yang berubah memakai `tabular-nums`
agar tidak "menari".

## Bentuk dan kedalaman

- Radius kecil: `3px` (kontrol) dan `6px` (stub tiket). Tidak ada elemen berbentuk pil.
- Tanpa bayangan. Hierarki dibangun dari warna permukaan (`paper` vs `paper-2`) dan garis putus-putus.
- Motif `.perforated` (lubang setengah lingkaran di kiri dan kanan) hanya dipakai pada stub tiket: info konser, ruang tunggu,
  nomor antrean, ringkasan checkout, pembayaran, dan e-ticket.

## Gerak

Dial MOTION = 1: hanya transisi hover dan lebar progress bar antrean (700 ms, menandai antrean bergerak).
Tidak ada animasi berulang. Titik status koneksi tidak berdenyut.

## Tema

Terang/gelap mengikuti sistem, dengan tombol "Tema gelap/terang" di header yang disimpan per perangkat.

## Halaman antrean

Sengaja paling ringan: tanpa gambar dan tanpa data event tambahan, karena di sinilah ribuan orang menunggu.
Isinya hanya nomor posisi, jumlah orang di depan, progress bar, ETA berupa rentang, dan status koneksi.
