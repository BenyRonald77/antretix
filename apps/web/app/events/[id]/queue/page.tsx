"use client";

import { formatEta } from "@antretix/shared";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { ConnectionIndicator, useQueuePage } from "@/components/QueueWatcher";
import { Button, Loading, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";

/**
 * Halaman antrean sengaja ringan: tanpa gambar, tanpa data event tambahan.
 * Di sinilah ribuan orang menunggu, jadi satu-satunya beban adalah aliran status.
 */
export default function QueuePage() {
  const { id: eventId } = useParams<{ id: string }>();
  const router = useRouter();
  const { state, mode, error } = useQueuePage(eventId, "queue");
  // Jumlah orang di depan saat pertama kali terlihat: patokan progress bar.
  const [firstAhead, setFirstAhead] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (
    state !== null &&
    state.state === "WAITING" &&
    (firstAhead === null || state.ahead > firstAhead)
  ) {
    setFirstAhead(state.ahead);
  }

  if (state === null || state.state !== "WAITING") {
    return <Loading what="posisi antrean" />;
  }

  const baseline = firstAhead ?? state.ahead;
  const progress = baseline === 0 ? 1 : 1 - state.ahead / baseline;

  const leave = async () => {
    if (!window.confirm("Keluar dari antrean? Posisi Anda akan hilang.")) {
      return;
    }

    setLeaving(true);
    await api(`/events/${eventId}/queue`, z.object({ code: z.string() }), {
      method: "DELETE",
    }).catch(() => null);
    router.replace(`/events/${eventId}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="text-3xl font-extrabold tracking-tight">Anda dalam antrean</h1>

      <section className="perforated rounded-md px-8 py-10 text-center" aria-label="Posisi antrean">
        <p className="text-sm font-semibold text-ink-2">Nomor antrean Anda</p>
        <p
          className="tabular mt-1 text-7xl font-black text-stamp sm:text-8xl"
          style={{ fontStretch: "118%" }}
        >
          {formatNumber(state.position)}
        </p>
        <p className="mt-3 text-ink-2">
          {state.ahead === 0
            ? "Anda berikutnya"
            : `${formatNumber(state.ahead)} orang di depan Anda`}{" "}
          · {formatNumber(state.total)} orang mengantre
        </p>
      </section>

      <div>
        <div
          className="h-3 w-full overflow-hidden rounded-sm bg-paper-2"
          role="progressbar"
          aria-label="Kemajuan antrean"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div
            className="h-full bg-ink transition-[width] duration-700"
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-lg">
          Perkiraan waktu tunggu: <strong>{formatEta(state.eta)}</strong>
        </p>
      </div>

      {state.paused ? (
        <Notice tone="warn">
          Antrean sedang dijeda penyelenggara. Posisi Anda tetap tersimpan dan akan bergerak lagi
          setelah dilanjutkan.
        </Notice>
      ) : null}
      {state.stockExhausted ? (
        <Notice tone="warn">
          Semua tiket sedang ditahan pembeli lain. Tiket yang tidak dibayar dalam 10 menit akan
          dilepas kembali, jadi antrean bisa bergerak lagi.
        </Notice>
      ) : null}

      <Notice tone="warn">
        Jangan tutup tab ini. Membuka tab baru menampilkan posisi yang sama, bukan posisi baru.
      </Notice>
      {error === null ? null : <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <ConnectionIndicator mode={mode} />
        <Button tone="quiet" onClick={leave} disabled={leaving}>
          Keluar dari antrean
        </Button>
      </div>
    </div>
  );
}
