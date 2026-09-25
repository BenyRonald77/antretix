"use client";

import { queueStateSchema, type QueueState } from "@antretix/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api, API_URL, ApiError, readToken } from "./api";
import { readStorage, useStorageItem, writeStorage } from "./storage";

export type ConnectionMode = "connecting" | "live" | "polling" | "reconnecting";

const statusResponse = z.object({ code: z.string(), state: queueStateSchema });

const POLL_INTERVAL_MS = 5000;

const SSE_RETRY_MS = 15_000;

function tokenKey(eventId: string): string {
  return `antretix.queue.${eventId}`;
}

export interface StoredQueueToken {
  token: string;
  expiresAt: string;
}

const storedTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });

export function saveQueueToken(eventId: string, value: StoredQueueToken): void {
  writeStorage("session", tokenKey(eventId), JSON.stringify(value));
}

function parseStoredToken(raw: string | null): StoredQueueToken | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = storedTokenSchema.safeParse(JSON.parse(raw));

    if (!parsed.success || new Date(parsed.data.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export function loadQueueToken(eventId: string): StoredQueueToken | null {
  return parseStoredToken(readStorage("session", tokenKey(eventId)));
}

/** Token antrean tersimpan untuk event ini; `undefined` selama render server/hidrasi. */
export function useStoredQueueToken(eventId: string): StoredQueueToken | null | undefined {
  const raw = useStorageItem("session", tokenKey(eventId));

  // Di-memo berdasarkan string mentahnya: objek baru di setiap render akan memicu ulang effect
  // yang bergantung padanya (misal polling stok di halaman checkout) tanpa henti.
  return useMemo(() => (raw === undefined ? undefined : parseStoredToken(raw)), [raw]);
}

export function clearQueueToken(eventId: string): void {
  writeStorage("session", tokenKey(eventId), null);
}

export async function fetchQueueState(eventId: string): Promise<QueueState> {
  const response = await api(`/events/${eventId}/queue/status`, statusResponse, {
    acceptStatus: [410],
  });

  return response.state;
}

/**
 * Status antrean real-time: SSE dulu; bila koneksi putus, beralih ke polling tiap 5 detik
 * dan mencoba SSE lagi setelah beberapa saat. Setiap update juga berfungsi sebagai heartbeat.
 */
export interface QueueConnection {
  state: QueueState | null;
  mode: ConnectionMode;
  error: string | null;
}

export function useQueueState(eventId: string, enabled: boolean): QueueConnection {
  const [state, setState] = useState<QueueState | null>(null);

  const [mode, setMode] = useState<ConnectionMode>(() =>
    "EventSource" in globalThis ? "connecting" : "polling",
  );

  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    finished.current = false;

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const apply = (next: QueueState) => {
      setState(next);
      setError(null);

      if (next.state === "ADMITTED") {
        saveQueueToken(eventId, { token: next.token, expiresAt: next.expiresAt });
      }

      if (next.state === "ADMITTED" || next.state === "SOLD_OUT" || next.state === "NOT_IN_QUEUE") {
        finished.current = true;
        source?.close();
        clearInterval(pollTimer);
      }
    };

    const poll = () => {
      fetchQueueState(eventId)
        .then((next) => {
          if (!disposed) {
            apply(next);
          }
        })
        .catch((cause: Error) => {
          if (!disposed) {
            setError(
              cause instanceof ApiError && cause.code === "RATE_LIMITED" ? null : cause.message,
            );
          }
        });
    };

    const startPolling = () => {
      if (pollTimer !== undefined || finished.current) {
        return;
      }

      poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    };

    const openStream = () => {
      const token = readToken();

      if (token === null || finished.current || disposed) {
        return;
      }

      source = new EventSource(
        `${API_URL}/events/${eventId}/queue/stream?access_token=${encodeURIComponent(token)}`,
      );

      source.addEventListener("open", () => {
        setMode("live");
        clearInterval(pollTimer);
        pollTimer = undefined;
      });

      source.addEventListener("status", (event) => {
        const parsed = queueStateSchema.safeParse(JSON.parse(event.data));

        if (parsed.success) {
          apply(parsed.data);
        }
      });

      source.addEventListener("error", () => {
        source?.close();

        if (finished.current || disposed) {
          return;
        }

        // Selama menyambung ulang, status tetap diperbarui lewat polling.
        setMode("reconnecting");
        startPolling();
        retryTimer = setTimeout(openStream, SSE_RETRY_MS);
      });
    };

    if (!("EventSource" in window)) {
      startPolling();
    } else {
      openStream();
    }

    return () => {
      disposed = true;
      source?.close();
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
    };
  }, [eventId, enabled]);

  return { state, mode, error };
}
