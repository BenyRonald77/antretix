"use client";

import type { QueueState } from "@antretix/shared";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRequireAuth } from "@/lib/auth";
import { useQueueState, type ConnectionMode, type QueueConnection } from "@/lib/queue";

type Page = "waiting" | "queue";

/** Arahkan pengguna ke halaman yang sesuai dengan status antreannya. */
function destination(eventId: string, state: QueueState, current: Page): string | null {
  switch (state.state) {
    case "ADMITTED":
      return `/events/${eventId}/checkout`;
    case "SOLD_OUT":
      return `/events/${eventId}/sold-out`;
    case "NOT_IN_QUEUE":
    case "NOT_STARTED":
      return `/events/${eventId}`;
    case "WAITING_ROOM":
      return current === "waiting" ? null : `/events/${eventId}/waiting`;
    case "WAITING":
      return current === "queue" ? null : `/events/${eventId}/queue`;
  }
}

export function useQueuePage(eventId: string, page: Page): QueueConnection {
  const user = useRequireAuth();
  const router = useRouter();
  const queue = useQueueState(eventId, user !== null);

  useEffect(() => {
    if (queue.state === null) {
      return;
    }

    const target = destination(eventId, queue.state, page);

    if (target !== null) {
      router.replace(target);
    }
  }, [eventId, page, queue.state, router]);

  return queue;
}

const modeText: Record<ConnectionMode, string> = {
  connecting: "Menghubungkan…",
  live: "Terhubung, posisi diperbarui otomatis",
  polling: "Posisi dicek setiap 5 detik",
  reconnecting: "Menyambung ulang… sementara posisi dicek setiap 5 detik",
};

export function ConnectionIndicator({ mode }: { mode: ConnectionMode }) {
  // Titik ini menandai status koneksi yang nyata (hijau = SSE hidup), tanpa animasi.
  const color = mode === "live" ? "bg-ok" : mode === "reconnecting" ? "bg-warn" : "bg-rule";

  return (
    <p className="flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      {modeText[mode]}
    </p>
  );
}
