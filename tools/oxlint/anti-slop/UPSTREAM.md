# Asal-usul plugin anti-slop

- **Sumber:** repositori GitHub `dmmulroy/anti-slop`, dipasang lewat skill `install-anti-slop`
  (`npx skills add https://github.com/dmmulroy/anti-slop --skill install-anti-slop`) pada 25 September 2026.
- **Commit sumber:** tidak diketahui. CLI `skills` tidak mencatat SHA commit. Yang tercatat adalah hash konten skill
  di `skills-lock.json` (`computedHash` = `d92d8dbdf1bd96e11ee33945dca76306179a7c415e7339769084b2c211c6897c`), dan salinan
  asli yang utuh ada di `.agents/skills/install-anti-slop/assets/anti-slop/`.
- **Cara salin:** `node .agents/skills/install-anti-slop/scripts/install.mjs` → `tools/oxlint/anti-slop/`.
- **Entry point:** `tools/oxlint/anti-slop/index.ts` (didaftarkan di `.oxlintrc.json` → `jsPlugins`).
  Plugin Effect (`effect/index.ts`) tidak diaktifkan karena repo ini tidak memakai `effect`.
- **Dependensi:** `oxlint@1.85.0` dan `@oxlint/plugins@1.85.0` (versi sama, dipin persis).
- **Penyimpangan disengaja:** tidak ada. Semua 18 aturan generik plus `oxc/no-accumulating-spread` aktif di level `error`.
- **Lisensi vendor:** `vendor/eslint-stylistic/LICENSE` dan `UPSTREAM.md` ikut tersalin apa adanya.
