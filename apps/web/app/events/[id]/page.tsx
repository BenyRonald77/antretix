"use client";

import { queueStateSchema, type EventView } from "@antretix/shared";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Turnstile } from "@/components/Turnstile";
import { Button, ButtonLink, Loading, Notice } from "@/components/ui";
import { api, ApiError, jsonBody } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { secondsUntil, useNow } from "@/lib/clock";
import { formatCountdown, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { saveQueueToken, useStoredQueueToken } from "@/lib/queue";
import { useEvent } from "@/lib/useEvent";

const joinResponse = z.object({ code: z.string(), state: queueStateSchema });

function TicketStub({ event }: { event: EventView }) {
  return (
    <section aria-label="Informasi konser" className="perforated rounded-md px-6 py-8 sm:px-10">
      <p className="text-sm font-semibold text-ink-2">{event.venue}</p>
      <h1
        className="mt-2 text-4xl leading-none font-black tracking-tight sm:text-6xl"
        style={{ fontStretch: "118%" }}
      >
        {event.name}
      </h1>
      <p className="mt-4 text-lg">{formatDateTime(event.startsAt)}</p>
      <div className="stub-rule mt-6 pt-4 text-sm text-ink-2">
        Ruang tunggu dibuka {formatDateTime(event.preQueueAt)} · Penjualan dibuka{" "}
        {formatDateTime(event.saleOpensAt)}
      </div>
    </section>
  );
}

export default function EventPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const { event, error, reload } = useEvent(eventId);
  const now = useNow(1000);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const storedToken = useStoredQueueToken(eventId);
  const hasToken = storedToken !== undefined && storedToken !== null;

  const nextBoundary =
    event === null
      ? null
      : event.queueStatus === "SCHEDULED"
        ? event.preQueueAt
        : event.queueStatus === "PREQUEUE"
          ? event.saleOpensAt
          : null;

  const secondsLeft = nextBoundary === null ? null : secondsUntil(nextBoundary, now);

  // Saat hitung mundur habis, muat ulang status event dari server.
  useEffect(() => {
    if (secondsLeft === 0) {
      const timer = setTimeout(reload, 1500);

      return () => clearTimeout(timer);
    }
  }, [secondsLeft, reload]);

  const onToken = useCallback((token: string | null) => setTurnstileToken(token), []);

  const join = async () => {
    if (user === null) {
      router.push(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);

      return;
    }

    setJoining(true);
    setJoinError(null);

    try {
      const response = await api(`/events/${eventId}/queue`, joinResponse, {
        method: "POST",
        body: jsonBody({ turnstileToken: turnstileToken ?? undefined }),
      });

      const state = response.state;

      if (state.state === "ADMITTED") {
        saveQueueToken(eventId, { token: state.token, expiresAt: state.expiresAt });
        router.push(`/events/${eventId}/checkout`);
      } else if (state.state === "WAITING_ROOM") {
        router.push(`/events/${eventId}/waiting`);
      } else {
        router.push(`/events/${eventId}/queue`);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SOLD_OUT") {
        router.push(`/events/${eventId}/sold-out`);

        return;
      }

      setJoinError(cause instanceof Error ? cause.message : "Gagal masuk antrean");
    } finally {
      setJoining(false);
    }
  };

  if (error !== null) {
    return <Notice tone="error">{error}</Notice>;
  }

  if (event === null) {
    return <Loading what="konser" />;
  }

  const canJoin =
    event.queueStatus === "PREQUEUE" ||
    event.queueStatus === "OPEN" ||
    event.queueStatus === "PAUSED";

  return (
    <div className="space-y-10">
      <TicketStub event={event} />

      <div className="grid gap-10 md:grid-cols-[3fr_2fr]">
        <section aria-labelledby="kategori">
          <h2 id="kategori" className="mb-3 text-xl font-bold">
            Kategori tiket
          </h2>
          <table className="w-full text-left">
            <thead className="text-sm text-ink-2">
              <tr className="border-b border-rule">
                <th className="py-2 font-semibold">Kategori</th>
                <th className="py-2 font-semibold">Harga</th>
                <th className="py-2 text-right font-semibold">Sisa</th>
              </tr>
            </thead>
            <tbody>
              {event.categories.map((category) => (
                <tr key={category.id} className="border-b border-rule">
                  <td className="py-3 font-semibold">{category.name}</td>
                  <td className="tabular py-3">{formatRupiah(category.price)}</td>
                  <td className="tabular py-3 text-right">
                    {category.remaining === 0 ? (
                      <span className="text-danger">Habis</span>
                    ) : (
                      `${formatNumber(category.remaining)} / ${formatNumber(category.quota)}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-2">
            Maksimal {event.maxPerUser} tiket per akun untuk konser ini.
          </p>
          {event.description.length > 0 ? (
            <p className="mt-6 max-w-prose leading-relaxed">{event.description}</p>
          ) : null}
        </section>

        <section aria-labelledby="beli" className="space-y-4">
          <h2 id="beli" className="text-xl font-bold">
            Beli tiket
          </h2>

          {event.queueStatus === "SCHEDULED" && secondsLeft !== null ? (
            <p>
              Ruang tunggu dibuka dalam{" "}
              <strong className="tabular text-2xl">{formatCountdown(secondsLeft)}</strong>
            </p>
          ) : null}

          {event.queueStatus === "PREQUEUE" && secondsLeft !== null ? (
            <p>
              Penjualan dibuka dalam{" "}
              <strong className="tabular text-2xl">{formatCountdown(secondsLeft)}</strong>. Masuk
              ruang tunggu sekarang: semua yang sudah di dalam saat jam buka akan diundi dengan
              peluang yang sama.
            </p>
          ) : null}

          {event.queueStatus === "OPEN" ? (
            <p>Penjualan sedang berlangsung. Anda akan masuk di urutan paling belakang antrean.</p>
          ) : null}
          {event.queueStatus === "PAUSED" ? (
            <Notice tone="warn">
              Antrean sedang dijeda oleh penyelenggara. Posisi Anda tetap tersimpan.
            </Notice>
          ) : null}

          {event.queueStatus === "SOLD_OUT" ? (
            <ButtonLink href={`/events/${eventId}/sold-out`} tone="secondary">
              Tiket habis, lihat info
            </ButtonLink>
          ) : null}

          {event.queueStatus === "CLOSED" ? (
            <p className="text-ink-2">Penjualan untuk konser ini sudah ditutup.</p>
          ) : null}

          {hasToken ? (
            <ButtonLink href={`/events/${eventId}/checkout`}>
              Lanjutkan ke pemilihan tiket
            </ButtonLink>
          ) : canJoin ? (
            <div className="space-y-3">
              {user === null ? null : <Turnstile onToken={onToken} />}
              <Button
                onClick={join}
                disabled={joining || (user !== null && turnstileToken === null)}
                className="w-full sm:w-auto"
              >
                {joining
                  ? "Memproses…"
                  : user === null
                    ? "Masuk untuk mulai antre"
                    : event.queueStatus === "PREQUEUE"
                      ? "Masuk Ruang Tunggu"
                      : "Masuk Antrean"}
              </Button>
              {joinError === null ? null : <Notice tone="error">{joinError}</Notice>}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
