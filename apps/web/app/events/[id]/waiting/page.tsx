"use client";

import { useParams } from "next/navigation";
import { ConnectionIndicator, useQueuePage } from "@/components/QueueWatcher";
import { Loading, Notice } from "@/components/ui";
import { secondsUntil, useNow } from "@/lib/clock";
import { formatCountdown, formatTime } from "@/lib/format";
import { useEvent } from "@/lib/useEvent";

export default function WaitingRoomPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const { state, mode, error } = useQueuePage(eventId, "waiting");
  const { event } = useEvent(eventId);
  const now = useNow(1000);

  if (state === null || event === null) {
    return <Loading what="ruang tunggu" />;
  }

  const saleOpensAt = state.state === "WAITING_ROOM" ? state.saleOpensAt : event.saleOpensAt;
  const secondsLeft = secondsUntil(saleOpensAt, now);

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <p className="text-sm font-semibold text-ink-2">{event.name}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Anda sudah di ruang tunggu</h1>
      </div>

      <section className="perforated rounded-md px-8 py-10 text-center">
        <p className="text-sm font-semibold text-ink-2">
          Penjualan dibuka pukul {formatTime(saleOpensAt)}
        </p>
        <p className="tabular mt-2 text-6xl font-black" style={{ fontStretch: "118%" }}>
          {formatCountdown(secondsLeft)}
        </p>
      </section>

      <div className="space-y-3 leading-relaxed">
        <p>
          Urutan semua orang di ruang tunggu akan <strong>diundi</strong> tepat saat penjualan
          dibuka. Datang lebih awal di dalam ruang tunggu tidak memberi keuntungan, dan me-refresh
          halaman tidak mengubah peluang Anda.
        </p>
        <p>
          Setelah undian, halaman ini otomatis berpindah ke antrean dan menampilkan nomor posisi
          Anda.
        </p>
      </div>

      <Notice tone="warn">
        Biarkan tab ini tetap terbuka. Bila tidak ada kabar dari tab ini lebih dari 2 menit, Anda
        dikeluarkan dari ruang tunggu.
      </Notice>
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      <ConnectionIndicator mode={mode} />
    </div>
  );
}
