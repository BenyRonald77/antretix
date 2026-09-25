"use client";

import { useParams } from "next/navigation";
import { ButtonLink, PageTitle } from "@/components/ui";
import { useEvent } from "@/lib/useEvent";

export default function SoldOutPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const { event } = useEvent(eventId);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageTitle sub={event?.name}>Tiket sudah habis</PageTitle>
      <p className="leading-relaxed">
        Semua tiket untuk konser ini sudah terjual dan antrean ditutup. Kami memberi tahu semua
        orang di antrean pada saat yang sama, jadi Anda tidak perlu menunggu sampai akhir.
      </p>
      <p className="leading-relaxed text-ink-2">
        Konser lain yang akan datang tercantum di halaman utama.
      </p>
      <ButtonLink href="/" tone="secondary">
        Lihat konser lain
      </ButtonLink>
    </div>
  );
}
