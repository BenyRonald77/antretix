"use client";

import { orderViewSchema, type OrderView } from "@antretix/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loading, Notice, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { formatDateTime, formatRupiah } from "@/lib/format";

const ordersResponse = z.object({ orders: z.array(orderViewSchema) });

const statusText: Record<OrderView["status"], string> = {
  PENDING: "Menunggu pembayaran",
  PAID: "Lunas",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
  REFUNDED: "Dana dikembalikan",
};

export default function OrdersPage() {
  const user = useRequireAuth();
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) {
      return;
    }

    api("/me/orders", ordersResponse)
      .then((response) => setOrders(response.orders))
      .catch((cause: Error) => setError(cause.message));
  }, [user]);

  return (
    <>
      <PageTitle>Tiket saya</PageTitle>
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {orders === null && error === null ? <Loading what="pesanan" /> : null}
      {orders !== null && orders.length === 0 ? (
        <Notice>
          Belum ada pesanan. Pilih konser di{" "}
          <Link href="/" className="underline">
            halaman utama
          </Link>{" "}
          untuk mulai antre.
        </Notice>
      ) : null}
      <ul className="divide-y divide-rule border-y border-rule">
        {(orders ?? []).map((order) => (
          <li key={order.id}>
            <Link
              href={order.status === "PENDING" ? `/orders/${order.id}/pay` : `/orders/${order.id}`}
              className="grid gap-1 py-4 hover:bg-paper-2 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6 sm:px-3"
            >
              <span>
                <span className="block font-bold">{order.eventName}</span>
                <span className="block text-sm text-ink-2">
                  {order.code} ·{" "}
                  {order.items.map((item) => `${item.qty}× ${item.categoryName}`).join(", ")} ·{" "}
                  {formatDateTime(order.createdAt)}
                </span>
              </span>
              <span className="tabular">{formatRupiah(order.totalPrice)}</span>
              <span
                className={`text-sm font-semibold ${order.status === "PAID" ? "text-ok" : order.status === "PENDING" ? "text-warn" : "text-ink-2"}`}
              >
                {statusText[order.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
