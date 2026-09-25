"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, ButtonLink, Loading, Notice, PageTitle } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { secondsUntil, useNow } from "@/lib/clock";
import { formatCountdown, formatRupiah } from "@/lib/format";
import { useOrder } from "@/lib/useOrder";

const payResponse = z.object({ code: z.string(), transactionId: z.string() });

export default function PayPage() {
  const { id: orderId } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireAuth();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { order, error: loadError } = useOrder(orderId, user !== null, 2000);
  const now = useNow(1000);

  useEffect(() => {
    if (order?.status === "PAID") {
      router.replace(`/orders/${orderId}`);
    }
  }, [order?.status, orderId, router]);

  if (loadError !== null && order === null) {
    return <Notice tone="error">{loadError}</Notice>;
  }

  if (order === null) {
    return <Loading what="pesanan" />;
  }

  const secondsLeft = secondsUntil(order.expiresAt, now);

  const pay = async (outcome: "success" | "fail") => {
    setProcessing(true);
    setError(null);

    try {
      await api(`/orders/${orderId}/pay`, payResponse, {
        method: "POST",
        body: jsonBody({ outcome }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembayaran gagal diproses");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageTitle sub={`${order.eventName} · Kode pesanan ${order.code}`}>Pembayaran</PageTitle>

      <section className="perforated rounded-md px-8 py-8">
        {order.items.map((item) => (
          <p key={item.categoryId} className="flex justify-between">
            <span>
              {item.qty} × {item.categoryName}
            </span>
            <span className="tabular">{formatRupiah(item.unitPrice * item.qty)}</span>
          </p>
        ))}
        <div className="stub-rule mt-4 flex items-end justify-between pt-4">
          <span className="text-ink-2">Total</span>
          <span className="tabular text-3xl font-black">{formatRupiah(order.totalPrice)}</span>
        </div>
      </section>

      {order.status === "PENDING" ? (
        <>
          <p className="text-lg">
            Selesaikan pembayaran dalam{" "}
            <strong className={`tabular text-2xl ${secondsLeft < 60 ? "text-danger" : ""}`}>
              {formatCountdown(secondsLeft)}
            </strong>
            . Setelah itu tiket dilepas untuk pembeli lain.
          </p>
          <Notice>
            Ini pembayaran simulasi (mock provider). Tombol di bawah meniru penyedia pembayaran yang
            memanggil webhook kita dengan payload bertanda tangan.
          </Notice>
          <div className="flex flex-wrap gap-4">
            <Button onClick={() => pay("success")} disabled={processing || secondsLeft === 0}>
              {processing ? "Menunggu konfirmasi…" : "Bayar sekarang"}
            </Button>
            <Button
              tone="secondary"
              onClick={() => pay("fail")}
              disabled={processing || secondsLeft === 0}
            >
              Simulasikan pembayaran gagal
            </Button>
          </div>
        </>
      ) : null}

      {order.status === "EXPIRED" ? (
        <Notice tone="error">
          Waktu pembayaran habis dan tiket sudah dilepas. Bila dana Anda terpotong setelah ini, dana
          akan dikembalikan.
        </Notice>
      ) : null}
      {order.status === "CANCELLED" ? (
        <Notice tone="error">Pembayaran gagal dan pesanan dibatalkan. Tiket sudah dilepas.</Notice>
      ) : null}
      {order.status === "REFUNDED" ? (
        <Notice tone="warn">
          Pembayaran masuk setelah pesanan kedaluwarsa, jadi dana dikembalikan.
        </Notice>
      ) : null}
      {order.status === "PAID" ? (
        <Notice tone="ok">Pembayaran berhasil. Mengalihkan ke e-ticket…</Notice>
      ) : null}

      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {order.status !== "PENDING" && order.status !== "PAID" ? (
        <ButtonLink href={`/events/${order.eventId}`} tone="secondary">
          Kembali ke halaman konser
        </ButtonLink>
      ) : null}
    </div>
  );
}
