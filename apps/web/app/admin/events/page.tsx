"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, Field, Loading, Notice, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  quota: z.number(),
  sold: z.number(),
  reserved: z.number(),
});

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  venue: z.string(),
  description: z.string(),
  startsAt: z.string(),
  saleOpensAt: z.string(),
  preQueueAt: z.string(),
  status: z.string(),
  admitPerSec: z.number(),
  maxActive: z.number(),
  maxPerUser: z.number(),
  categories: z.array(categorySchema),
});

const eventsResponse = z.object({ events: z.array(eventSchema) });

const saveResponse = z.object({ id: z.string() });

type AdminEvent = z.infer<typeof eventSchema>;

interface CategoryDraft {
  id?: string;
  name: string;
  price: string;
  quota: string;
}

interface EventDraft {
  id?: string;
  name: string;
  venue: string;
  description: string;
  startsAt: string;
  saleOpensAt: string;
  preQueueAt: string;
  admitPerSec: string;
  maxActive: string;
  maxPerUser: string;
  status: "DRAFT" | "SCHEDULED";
  categories: CategoryDraft[];
}

/** Nilai untuk <input type="datetime-local"> dalam zona waktu browser. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function emptyDraft(): EventDraft {
  const inOneHour = new Date(Date.now() + 60 * 60_000).toISOString();
  const inHalfHour = new Date(Date.now() + 30 * 60_000).toISOString();
  const inAMonth = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

  return {
    name: "",
    venue: "",
    description: "",
    startsAt: toLocalInput(inAMonth),
    saleOpensAt: toLocalInput(inOneHour),
    preQueueAt: toLocalInput(inHalfHour),
    admitPerSec: "50",
    maxActive: "500",
    maxPerUser: "4",
    status: "SCHEDULED",
    categories: [{ name: "", price: "", quota: "" }],
  };
}

function draftFrom(event: AdminEvent): EventDraft {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    description: event.description,
    startsAt: toLocalInput(event.startsAt),
    saleOpensAt: toLocalInput(event.saleOpensAt),
    preQueueAt: toLocalInput(event.preQueueAt),
    admitPerSec: String(event.admitPerSec),
    maxActive: String(event.maxActive),
    maxPerUser: String(event.maxPerUser),
    status: event.status === "DRAFT" ? "DRAFT" : "SCHEDULED",
    categories: event.categories.map((category) => ({
      id: category.id,
      name: category.name,
      price: String(category.price),
      quota: String(category.quota),
    })),
  };
}

function EventForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: EventDraft;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof Omit<EventDraft, "categories" | "id" | "status">, value: string) =>
    setDraft({ ...draft, [field]: value });

  const setCategory = (index: number, field: "name" | "price" | "quota", value: string) => {
    const categories = draft.categories.slice();
    const current = categories[index];

    if (current !== undefined) {
      categories[index] = { ...current, [field]: value };
      setDraft({ ...draft, categories });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const body = {
      id: draft.id,
      name: draft.name,
      venue: draft.venue,
      description: draft.description,
      startsAt: new Date(draft.startsAt).toISOString(),
      saleOpensAt: new Date(draft.saleOpensAt).toISOString(),
      preQueueAt: new Date(draft.preQueueAt).toISOString(),
      status: draft.status,
      admitPerSec: Number(draft.admitPerSec),
      maxActive: Number(draft.maxActive),
      maxPerUser: Number(draft.maxPerUser),
      categories: draft.categories.map((category) => ({
        id: category.id,
        name: category.name,
        price: Number(category.price),
        quota: Number(category.quota),
      })),
    };

    try {
      await api("/admin/events", saveResponse, { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 border-y border-rule py-6">
      <h2 className="text-xl font-bold">
        {draft.id === undefined ? "Event baru" : `Ubah: ${initial.name}`}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Nama konser"
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          required
        />
        <Field
          label="Venue"
          value={draft.venue}
          onChange={(event) => set("venue", event.target.value)}
          required
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Deskripsi</span>
        <textarea
          className="min-h-24 w-full rounded-sm border border-rule bg-paper px-3 py-2"
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Ruang tunggu dibuka"
          type="datetime-local"
          value={draft.preQueueAt}
          onChange={(event) => set("preQueueAt", event.target.value)}
          hint="Biasanya 30 menit sebelum penjualan"
          required
        />
        <Field
          label="Penjualan dibuka"
          type="datetime-local"
          value={draft.saleOpensAt}
          onChange={(event) => set("saleOpensAt", event.target.value)}
          required
        />
        <Field
          label="Konser dimulai"
          type="datetime-local"
          value={draft.startsAt}
          onChange={(event) => set("startsAt", event.target.value)}
          required
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Laju admission (orang/detik)"
          type="number"
          min={1}
          value={draft.admitPerSec}
          onChange={(event) => set("admitPerSec", event.target.value)}
          required
        />
        <Field
          label="Maks. pengguna aktif"
          type="number"
          min={1}
          value={draft.maxActive}
          onChange={(event) => set("maxActive", event.target.value)}
          required
        />
        <Field
          label="Maks. tiket per akun"
          type="number"
          min={1}
          max={20}
          value={draft.maxPerUser}
          onChange={(event) => set("maxPerUser", event.target.value)}
          required
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">Kategori tiket</legend>
        {draft.categories.map((category, index) => (
          <div
            key={category.id ?? `baru-${index}`}
            className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
          >
            <Field
              label="Nama"
              value={category.name}
              onChange={(event) => setCategory(index, "name", event.target.value)}
              placeholder="Festival"
              required
            />
            <Field
              label="Harga (Rp)"
              type="number"
              min={0}
              value={category.price}
              onChange={(event) => setCategory(index, "price", event.target.value)}
              required
            />
            <Field
              label="Kuota"
              type="number"
              min={1}
              value={category.quota}
              onChange={(event) => setCategory(index, "quota", event.target.value)}
              required
            />
            {category.id === undefined && draft.categories.length > 1 ? (
              <Button
                type="button"
                tone="quiet"
                onClick={() =>
                  setDraft({
                    ...draft,
                    categories: draft.categories.filter((_, position) => position !== index),
                  })
                }
              >
                Hapus
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        <Button
          type="button"
          tone="quiet"
          onClick={() =>
            setDraft({
              ...draft,
              categories: [...draft.categories, { name: "", price: "", quota: "" }],
            })
          }
        >
          Tambah kategori
        </Button>
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.status === "DRAFT"}
          onChange={(event) =>
            setDraft({ ...draft, status: event.target.checked ? "DRAFT" : "SCHEDULED" })
          }
        />
        Simpan sebagai draft (tidak tampil ke publik)
      </label>

      {error === null ? null : <Notice tone="error">{error}</Notice>}
      <div className="flex gap-4">
        <Button type="submit" disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan event"}
        </Button>
        <Button type="button" tone="secondary" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  );
}

export default function AdminEventsPage() {
  const user = useRequireAuth();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventDraft | null>(null);

  const load = useCallback(() => {
    api("/admin/events", eventsResponse)
      .then((response) => setEvents(response.events))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (user?.role === "ADMIN") {
      load();
    }
  }, [user, load]);

  if (user !== null && user.role !== "ADMIN") {
    return <Notice tone="error">Halaman ini khusus admin.</Notice>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle sub="Buat konser, atur kategori dan kuota, lalu pantau penjualan secara langsung.">
          Event
        </PageTitle>
        {editing === null ? (
          <Button onClick={() => setEditing(emptyDraft())}>Buat event</Button>
        ) : null}
      </div>

      {editing === null ? null : (
        <EventForm
          key={editing.id ?? "baru"}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {events === null && error === null ? <Loading what="event" /> : null}

      <ul className="divide-y divide-rule border-y border-rule">
        {(events ?? []).map((event) => {
          let sold = 0;
          let quota = 0;

          for (const category of event.categories) {
            sold += category.sold;
            quota += category.quota;
          }

          return (
            <li key={event.id} className="grid gap-3 py-5 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-lg font-bold">{event.name}</p>
                <p className="text-sm text-ink-2">
                  {event.status} · Penjualan {formatDateTime(event.saleOpensAt)} ·{" "}
                  {formatNumber(sold)} / {formatNumber(quota)} terjual
                </p>
                <p className="text-sm text-ink-2">
                  {event.categories
                    .map((category) => `${category.name} ${formatRupiah(category.price)}`)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <Link
                  href={`/admin/events/${event.id}/live`}
                  className="font-semibold underline underline-offset-4"
                >
                  Pantau live
                </Link>
                <Button tone="quiet" onClick={() => setEditing(draftFrom(event))}>
                  Ubah
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
