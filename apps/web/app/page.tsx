"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loading, Notice, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const eventsResponse = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      venue: z.string(),
      startsAt: z.string(),
      saleOpensAt: z.string(),
      status: z.string(),
    }),
  ),
});

type EventRow = z.infer<typeof eventsResponse>["events"][number];

const statusLabel = new Map([
  ["SCHEDULED", "Penjualan belum dibuka"],
  ["ON_SALE", "Sedang dijual"],
  ["SOLD_OUT", "Habis"],
  ["ENDED", "Selesai"],
]);

export default function HomePage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/events", eventsResponse)
      .then((response) => setEvents(response.events))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  return (
    <>
      <PageTitle sub="Setiap penjualan memakai ruang tunggu virtual. Datang sebelum jam buka, urutan Anda diundi. Datang sesudahnya, Anda antre sesuai waktu kedatangan.">
        Konser yang akan datang
      </PageTitle>
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {events === null && error === null ? <Loading what="daftar konser" /> : null}
      {events !== null && events.length === 0 ? (
        <Notice>
          Belum ada konser yang dijadwalkan. Admin dapat membuat event di halaman Admin.
        </Notice>
      ) : null}
      <ul className="divide-y divide-rule border-y border-rule">
        {(events ?? []).map((event) => (
          <li key={event.id}>
            <Link
              href={`/events/${event.id}`}
              className="grid gap-1 py-5 hover:bg-paper-2 sm:grid-cols-[1fr_auto] sm:items-center sm:px-3"
            >
              <span>
                <span className="block text-xl font-bold">{event.name}</span>
                <span className="block text-ink-2">
                  {event.venue} · {formatDateTime(event.startsAt)}
                </span>
              </span>
              <span className="text-sm font-semibold">
                {statusLabel.get(event.status) ?? event.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
