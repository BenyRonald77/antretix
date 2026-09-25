export interface EtaRange {
  minSec: number;
  maxSec: number;
}

/**
 * ETA = posisi / throughput aktual (pengguna di-admit per detik, 60 detik terakhir).
 * Bila belum ada data throughput, laju yang dikonfigurasi dipakai sebagai perkiraan kasar.
 * Hasilnya berupa rentang ±20% karena ditampilkan sebagai "sekitar X–Y menit", bukan angka pasti.
 */
export function estimateWait(
  position: number,
  observedPerSec: number,
  fallbackPerSec: number,
): EtaRange | null {
  if (position <= 0) {
    return { minSec: 0, maxSec: 0 };
  }

  const rate = observedPerSec > 0 ? observedPerSec : fallbackPerSec;

  if (rate <= 0) {
    return null;
  }

  const seconds = position / rate;

  return { minSec: Math.floor(seconds * 0.8), maxSec: Math.ceil(seconds * 1.2) };
}

/** Rata-rata admit per detik dari log admission; setiap entri adalah jumlah admit pada satu tick. */
export function observedThroughput(admitCounts: readonly number[], windowSec: number): number {
  if (windowSec <= 0) {
    return 0;
  }

  let total = 0;

  for (const count of admitCounts) {
    total += count;
  }

  return total / windowSec;
}

export function formatEta(eta: EtaRange | null): string {
  if (eta === null) {
    return "menunggu antrean bergerak";
  }

  if (eta.maxSec < 60) {
    return "kurang dari 1 menit";
  }

  const minMinutes = Math.max(1, Math.floor(eta.minSec / 60));
  const maxMinutes = Math.max(minMinutes + 1, Math.ceil(eta.maxSec / 60));

  return `sekitar ${minMinutes}–${maxMinutes} menit`;
}
