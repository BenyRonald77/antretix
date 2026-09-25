"use client";

import { adminMetricsSchema, type AdminMetrics } from "@antretix/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { LineChart, type Sample } from "@/components/LineChart";
import { Button, Loading, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { formatNumber, formatTime } from "@/lib/format";

const POLL_MS = 2000;

const HISTORY = 150; // 5 menit pada interval 2 detik

const controlResponse = z.object({ queueStatus: z.string() });

const statusText: Record<AdminMetrics["queueStatus"], string> = {
  SCHEDULED: "Terjadwal (ruang tunggu belum dibuka)",
  PREQUEUE: "Ruang tunggu terbuka, penjualan belum dimulai",
  OPEN: "Penjualan berjalan",
  PAUSED: "Antrean dijeda",
  SOLD_OUT: "Habis terjual, antrean ditutup",
  CLOSED: "Ditutup",
};

function StockBars({ categories }: { categories: AdminMetrics["categories"] }) {
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
        <span className="font-semibold">Kuota per kategori: terjual, ditahan, dan sisa</span>
        <span className="flex gap-4 text-sm text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[2px] bg-series-sold" aria-hidden />{" "}
            Terjual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[2px] bg-series-held" aria-hidden />{" "}
            Ditahan (belum dibayar)
          </span>
        </span>
      </figcaption>
      <div className="space-y-4">
        {categories.map((category) => {
          const soldPct = (category.sold / category.quota) * 100;
          const heldPct = (category.reserved / category.quota) * 100;
          const available = category.quota - category.sold - category.reserved;

          return (
            <div key={category.id}>
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                <span className="font-semibold">{category.name}</span>
                <span className="tabular text-ink-2">
                  {formatNumber(category.sold)} terjual · {formatNumber(category.reserved)} ditahan
                  · {formatNumber(available)} sisa dari {formatNumber(category.quota)}
                </span>
              </div>
              <div
                className="flex h-4 w-full gap-[2px] overflow-hidden rounded-sm bg-paper-2"
                title={`${category.name}: ${category.sold} terjual, ${category.reserved} ditahan, ${available} sisa`}
              >
                {soldPct > 0 ? (
                  <div className="h-full bg-series-sold" style={{ width: `${soldPct}%` }} />
                ) : null}
                {heldPct > 0 ? (
                  <div className="h-full bg-series-held" style={{ width: `${heldPct}%` }} />
                ) : null}
              </div>
              {available !== category.redisStock ? (
                <p className="mt-1 text-xs text-warn">
                  Stok Redis {formatNumber(category.redisStock)} berbeda dari PostgreSQL{" "}
                  {formatNumber(available)}. Selisih sesaat wajar saat reservasi berjalan;
                  rekonsiliasi mengoreksi selisih yang menetap.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export default function LivePage() {
  const { id: eventId } = useParams<{ id: string }>();
  const user = useRequireAuth();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [history, setHistory] = useState<AdminMetrics[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api(`/admin/events/${eventId}/metrics`, adminMetricsSchema)
      .then((next) => {
        setMetrics(next);
        setHistory((previous) => [...previous.slice(-(HISTORY - 1)), next]);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [eventId]);

  useEffect(() => {
    if (user === null) {
      return;
    }

    load();

    const timer = setInterval(load, POLL_MS);

    return () => clearInterval(timer);
  }, [user, load]);

  const control = async (body: Record<string, number | string>) => {
    setSaving(true);

    try {
      await api(`/admin/events/${eventId}/queue`, controlResponse, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  if (user !== null && user.role !== "ADMIN") {
    return <Notice tone="error">Halaman ini khusus admin.</Notice>;
  }

  if (metrics === null) {
    return error === null ? <Loading what="metrik live" /> : <Notice tone="error">{error}</Notice>;
  }

  const series = (pick: (sample: AdminMetrics) => number): Sample[] =>
    history.map((sample) => ({ at: sample.timestamp, value: pick(sample) }));

  const canPause = metrics.queueStatus === "OPEN";
  const canResume = metrics.queueStatus === "PAUSED";

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/events" className="text-sm text-ink-2 hover:underline">
            Semua event
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Pantauan penjualan</h1>
          <p className="mt-1 text-ink-2">
            {statusText[metrics.queueStatus]} · diperbarui {formatTime(metrics.timestamp)}
          </p>
        </div>
        {canPause ? (
          <Button tone="danger" onClick={() => control({ action: "pause" })} disabled={saving}>
            Jeda antrean
          </Button>
        ) : null}
        {canResume ? (
          <Button onClick={() => control({ action: "resume" })} disabled={saving}>
            Lanjutkan antrean
          </Button>
        ) : null}
      </header>

      {error === null ? null : <Notice tone="error">{error}</Notice>}

      {/* Keputusan utama di layar ini: apakah laju admission perlu diubah atau antrean perlu dijeda. */}
      <section className="grid gap-8 border-y border-rule py-6 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="block">
          <span className="mb-1 block font-semibold">
            Laju admission: <span className="tabular">{rate ?? metrics.admitPerSec}</span>{" "}
            orang/detik
          </span>
          <input
            type="range"
            min={1}
            max={500}
            value={rate ?? metrics.admitPerSec}
            onChange={(event) => setRate(Number(event.target.value))}
            className="w-full accent-[var(--ink)]"
          />
          <span className="text-sm text-ink-2">
            Aktual 60 detik terakhir: {metrics.observedAdmitPerSec.toFixed(1)} orang/detik
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">Maksimal pengguna aktif di checkout</span>
          <input
            type="number"
            min={1}
            value={maxActive ?? metrics.maxActive}
            onChange={(event) => setMaxActive(Number(event.target.value))}
            className="tabular w-full rounded-sm border border-rule bg-paper px-3 py-2"
          />
          <span className="text-sm text-ink-2">
            Saat ini aktif: {formatNumber(metrics.activeUsers)}
          </span>
        </label>
        <Button
          tone="secondary"
          disabled={
            saving ||
            ((rate ?? metrics.admitPerSec) === metrics.admitPerSec &&
              (maxActive ?? metrics.maxActive) === metrics.maxActive)
          }
          onClick={() =>
            control({
              admitPerSec: rate ?? metrics.admitPerSec,
              maxActive: maxActive ?? metrics.maxActive,
            })
          }
        >
          Terapkan
        </Button>
      </section>

      <section className="grid gap-10 md:grid-cols-2">
        <LineChart title="Orang di antrean" samples={series((sample) => sample.queueLength)} />
        <LineChart
          title="Pengguna aktif di checkout"
          samples={series((sample) => sample.activeUsers)}
          reference={{
            label: `batas ${formatNumber(metrics.maxActive)}`,
            value: metrics.maxActive,
          }}
        />
        <LineChart
          title="Order dibuat per menit"
          samples={series((sample) => sample.ordersPerMinute)}
        />
        <LineChart
          title="Order dibayar per menit"
          samples={series((sample) => sample.paidPerMinute)}
        />
      </section>

      <p className="text-sm text-ink-2">
        Grafik menampilkan hingga 5 menit terakhir sejak halaman ini dibuka.
      </p>

      <StockBars categories={metrics.categories} />
    </div>
  );
}
