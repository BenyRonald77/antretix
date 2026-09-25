"use client";

import { categoryViewSchema, orderViewSchema } from "@antretix/shared";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button, ButtonLink, Loading, Notice, PageTitle } from "@/components/ui";
import { api, ApiError, jsonBody } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { secondsUntil, useNow } from "@/lib/clock";
import { formatCountdown, formatNumber, formatRupiah } from "@/lib/format";
import { clearQueueToken, useStoredQueueToken } from "@/lib/queue";

const stockResponse = z.object({
  categories: z.array(categoryViewSchema),
  sessionExpiresAt: z.string(),
  maxPerUser: z.number(),
  alreadyHeld: z.number(),
});

type Stock = z.infer<typeof stockResponse>;

const orderResponse = z.object({ order: orderViewSchema });

export default function CheckoutPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireAuth();
  const now = useNow(1000);
  const queueToken = useStoredQueueToken(eventId);
  const [stock, setStock] = useState<Stock | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Satu idempotency key per percobaan checkout: klik ganda / retry jaringan tidak membuat order kedua.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const loadStock = useCallback(
    (token: string) => {
      api(`/events/${eventId}/stock`, stockResponse, { headers: { "x-queue-token": token } })
        .then((next) => {
          setStock(next);
          setError(null);
        })
        .catch((cause: Error) => {
          if (cause instanceof ApiError && cause.code === "QUEUE_TOKEN_REQUIRED") {
            clearQueueToken(eventId);
          }

          setError(cause.message);
        });
    },
    [eventId],
  );

  useEffect(() => {
    if (user === null || queueToken === undefined || queueToken === null) {
      return;
    }

    loadStock(queueToken.token);

    // Sisa stok diperbarui berkala selama pembeli memilih.
    const timer = setInterval(() => loadStock(queueToken.token), 5000);

    return () => clearInterval(timer);
  }, [user, queueToken, loadStock]);

  const selected = useMemo(
    () => stock?.categories.find((category) => category.id === categoryId) ?? null,
    [stock, categoryId],
  );

  const allowance = stock === null ? 0 : Math.max(0, stock.maxPerUser - stock.alreadyHeld);
  const maxQty = selected === null ? allowance : Math.min(allowance, selected.remaining);

  if (queueToken === null) {
    return (
      <div className="max-w-xl space-y-4">
        <PageTitle>Sesi checkout tidak ditemukan</PageTitle>
        <p>
          Halaman ini hanya bisa dibuka setelah giliran Anda tiba di antrean, dan sesi berlaku 10
          menit sejak Anda diizinkan masuk.
        </p>
        <ButtonLink href={`/events/${eventId}`}>Kembali ke halaman konser</ButtonLink>
      </div>
    );
  }

  if (queueToken === undefined || stock === null) {
    return error === null ? (
      <Loading what="pilihan tiket" />
    ) : (
      <Notice tone="error">{error}</Notice>
    );
  }

  const sessionLeft = secondsUntil(stock.sessionExpiresAt, now);

  const submit = async () => {
    if (selected === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await api(`/events/${eventId}/orders`, orderResponse, {
        method: "POST",
        headers: { "x-queue-token": queueToken.token, "idempotency-key": idempotencyKey },
        body: jsonBody({ categoryId: selected.id, qty }),
      });

      router.push(`/orders/${response.order.id}/pay`);
    } catch (cause) {
      // Percobaan yang ditolak server boleh dicoba lagi dengan pilihan lain: pakai key baru.
      setIdempotencyKey(crypto.randomUUID());
      setError(cause instanceof Error ? cause.message : "Gagal membuat pesanan");
      loadStock(queueToken.token);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10 md:grid-cols-[3fr_2fr]">
      <div>
        <PageTitle sub="Tiket yang Anda pilih ditahan 10 menit untuk pembayaran. Harga dikunci saat pesanan dibuat.">
          Pilih tiket
        </PageTitle>

        {sessionLeft === 0 ? (
          <Notice tone="error">
            Sesi checkout Anda sudah habis. Silakan masuk antrean lagi dari halaman konser.
          </Notice>
        ) : null}

        <fieldset className="space-y-3" disabled={sessionLeft === 0}>
          <legend className="mb-2 font-semibold">Kategori</legend>
          {stock.categories.map((category) => {
            const soldOut = category.remaining === 0;

            return (
              <label
                key={category.id}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-sm border px-4 py-3 ${
                  categoryId === category.id ? "border-ink bg-paper-2" : "border-rule"
                } ${soldOut ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="category"
                    value={category.id}
                    checked={categoryId === category.id}
                    disabled={soldOut}
                    onChange={() => {
                      setCategoryId(category.id);
                      setQty(1);
                    }}
                  />
                  <span>
                    <span className="block font-semibold">{category.name}</span>
                    <span className="tabular block text-sm text-ink-2">
                      {soldOut ? "Habis" : `Sisa ${formatNumber(category.remaining)}`}
                    </span>
                  </span>
                </span>
                <span className="tabular font-semibold">{formatRupiah(category.price)}</span>
              </label>
            );
          })}

          <label className="mt-6 block max-w-40">
            <span className="mb-1 block font-semibold">Jumlah</span>
            <select
              className="w-full rounded-sm border border-rule bg-paper px-3 py-2.5"
              value={qty}
              onChange={(event) => setQty(Number(event.target.value))}
              disabled={selected === null || maxQty === 0}
            >
              {Array.from({ length: Math.max(1, maxQty) }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-ink-2">
            Batas {stock.maxPerUser} tiket per akun.{" "}
            {stock.alreadyHeld > 0
              ? `Anda sudah memegang ${stock.alreadyHeld} tiket untuk konser ini.`
              : ""}
          </p>
        </fieldset>
      </div>

      <aside className="space-y-5 self-start md:sticky md:top-6">
        <div className="perforated rounded-md px-6 py-6">
          <p className="text-sm font-semibold text-ink-2">Sisa waktu sesi</p>
          <p className={`tabular text-4xl font-black ${sessionLeft < 60 ? "text-danger" : ""}`}>
            {formatCountdown(sessionLeft)}
          </p>
          <div className="stub-rule mt-4 pt-4">
            <p className="text-sm text-ink-2">Total</p>
            <p className="tabular text-2xl font-bold">
              {selected === null ? "—" : formatRupiah(selected.price * qty)}
            </p>
            {selected === null ? null : (
              <p className="text-sm text-ink-2">
                {qty} × {selected.name}
              </p>
            )}
          </div>
        </div>
        {allowance === 0 ? (
          <Notice tone="warn">
            Anda sudah mencapai batas {stock.maxPerUser} tiket per akun untuk konser ini.
          </Notice>
        ) : null}
        {error === null ? null : <Notice tone="error">{error}</Notice>}
        <Button
          className="w-full"
          onClick={submit}
          disabled={busy || selected === null || maxQty === 0 || sessionLeft === 0}
        >
          {busy ? "Menahan tiket…" : "Tahan tiket & lanjut bayar"}
        </Button>
      </aside>
    </div>
  );
}
