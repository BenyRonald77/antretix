"use client";

import { useSyncExternalStore } from "react";

export type StorageArea = "local" | "session";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function areaOf(area: StorageArea): Storage {
  return area === "local" ? window.localStorage : window.sessionStorage;
}

export function readStorage(area: StorageArea, key: string): string | null {
  try {
    return areaOf(area).getItem(key);
  } catch {
    return null;
  }
}

/** Menulis (atau menghapus bila null) lalu memberi tahu semua komponen yang membaca key tersebut. */
export function writeStorage(area: StorageArea, key: string, value: string | null): void {
  try {
    if (value === null) {
      areaOf(area).removeItem(key);
    } else {
      areaOf(area).setItem(key, value);
    }
  } catch {
    // Penyimpanan diblokir (mode privat): nilai tidak bertahan setelah halaman ditutup.
  }

  for (const listener of listeners) {
    listener();
  }
}

/**
 * Membaca browser storage tanpa setState di dalam effect.
 * Mengembalikan `undefined` saat render server/hidrasi, lalu nilai sebenarnya (string | null) di browser.
 */
export function useStorageItem(area: StorageArea, key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readStorage(area, key),
    () => undefined,
  );
}
