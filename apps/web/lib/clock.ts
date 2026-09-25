"use client";

import { useEffect, useState } from "react";

/**
 * Jam lokal yang disetel ke jam server. Hitung mundur penjualan tidak boleh bergantung
 * pada jam perangkat pengguna yang bisa meleset beberapa menit.
 */
let serverOffsetMs = 0;

export function syncServerClock(serverTimeIso: string): void {
  serverOffsetMs = new Date(serverTimeIso).getTime() - Date.now();
}

export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}
