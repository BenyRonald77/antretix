"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { ButtonLink, Loading, Notice, PageTitle } from "@/components/ui";
import { useRequireAuth } from "@/lib/auth";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useOrder } from "@/lib/useOrder";

function TicketQr({ code, label }: { code: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Isi QR adalah kode tiket unik; pemindai di gerbang mencocokkannya ke database.
    QRCode.toDataURL(`ANTRETIX:${code}`, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [code]);

  if (dataUrl === null) {
    return <div className="h-44 w-44 bg-paper-2" aria-label="Membuat QR" />;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Image
        src={dataUrl}
        alt={`QR tiket ${label}`}
        width={176}
        height={176}
        unoptimized
        className="rounded-sm bg-white p-1"
      />
      <a
        href={dataUrl}
        download={`${code}.png`}
        className="text-sm font-semibold underline underline-offset-4"
      >
        Unduh QR
      </a>
    </div>
  );
}

export default function OrderPage() {
  const { id: orderId } = useParams<{ id: string }>();
  const user = useRequireAuth();
  const { order, error } = useOrder(orderId, user !== null, null);

  if (error !== null) {
    return <Notice tone="error">{error}</Notice>;
  }

  if (order === null) {
    return <Loading what="e-ticket" />;
  }

  return (
    <div className="space-y-8">
      <PageTitle sub={`Kode pesanan ${order.code} · ${formatRupiah(order.totalPrice)}`}>
        {order.eventName}
      </PageTitle>

      {order.status === "PENDING" ? (
        <Notice tone="warn">
          Pesanan ini belum dibayar.{" "}
          <ButtonLink href={`/orders/${order.id}/pay`} tone="quiet">
            Lanjutkan pembayaran
          </ButtonLink>
        </Notice>
      ) : null}
      {order.status !== "PAID" && order.status !== "PENDING" ? (
        <Notice tone="error">
          Pesanan berstatus {order.status}. Tidak ada tiket yang diterbitkan.
        </Notice>
      ) : null}

      {order.status === "PAID" ? (
        <>
          <p className="text-ink-2">
            Dibayar {order.paidAt === null ? "" : formatDateTime(order.paidAt)}. Tunjukkan QR di
            bawah di pintu masuk; setiap QR hanya berlaku untuk satu orang.
          </p>
          <ul className="grid gap-6 sm:grid-cols-2">
            {order.tickets.map((ticket, index) => (
              <li
                key={ticket.id}
                className="perforated grid grid-cols-[1fr_auto] items-center gap-4 rounded-md px-6 py-6"
              >
                <div>
                  <p className="text-sm text-ink-2">
                    Tiket {index + 1} dari {order.tickets.length}
                  </p>
                  <p className="text-2xl font-black" style={{ fontStretch: "115%" }}>
                    {ticket.categoryName}
                  </p>
                  <p className="mt-3 font-mono text-xs break-all text-ink-2">{ticket.code}</p>
                  {ticket.checkedIn ? (
                    <p className="mt-2 text-sm font-semibold text-warn">Sudah dipakai masuk</p>
                  ) : null}
                </div>
                <TicketQr code={ticket.code} label={`${ticket.categoryName} ${index + 1}`} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
