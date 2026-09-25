import { DEFAULTS } from "@antretix/shared";
import { createPrisma, DEMO_EVENT_ID, hashPassword } from "./index";

/**
 * Seed event demo: 1 konser, 3 kategori (Festival 3.000, Tribun 1.500, VIP 500 = 5.000 tiket),
 * plus akun admin dan akun pembeli contoh.
 *
 * SEED_PREQUEUE_OFFSET_MIN / SEED_SALE_OFFSET_MIN mengatur kapan ruang tunggu dan penjualan dibuka
 * relatif terhadap waktu seed (default: ruang tunggu langsung buka, penjualan 3 menit lagi).
 */
const prisma = createPrisma();

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

async function main(): Promise<void> {
  const preQueueOffset = Number(process.env.SEED_PREQUEUE_OFFSET_MIN ?? "0");
  const saleOffset = Number(process.env.SEED_SALE_OFFSET_MIN ?? "3");

  const adminPassword = await hashPassword("admin12345");
  const fanPassword = await hashPassword("fan12345");

  await prisma.user.upsert({
    where: { email: "admin@antretix.dev" },
    update: { role: "ADMIN" },
    create: {
      email: "admin@antretix.dev",
      name: "Admin AntreTix",
      role: "ADMIN",
      passwordHash: adminPassword,
    },
  });

  await prisma.user.upsert({
    where: { email: "fan@antretix.dev" },
    update: {},
    create: { email: "fan@antretix.dev", name: "Fans Contoh", passwordHash: fanPassword },
  });

  const eventData = {
    name: "Senandung Nusantara Live 2026",
    venue: "Stadion Utama Gelora Bung Karno, Jakarta",
    description:
      "Konser tahunan dengan lima musisi lintas generasi. Penjualan memakai ruang tunggu virtual: siapa pun yang masuk sebelum jam buka punya peluang yang sama, setelahnya berlaku urutan kedatangan.",
    posterUrl: "",
    startsAt: minutesFromNow(60 * 24 * 30),
    saleOpensAt: minutesFromNow(saleOffset),
    preQueueAt: minutesFromNow(preQueueOffset),
    status: "SCHEDULED" as const,
    admitPerSec: DEFAULTS.admitPerSec,
    maxActive: DEFAULTS.maxActive,
    maxPerUser: DEFAULTS.maxPerUser,
  };

  await prisma.event.upsert({
    where: { id: DEMO_EVENT_ID },
    update: eventData,
    create: { id: DEMO_EVENT_ID, ...eventData },
  });

  const categories = [
    { id: "demo-festival", name: "Festival", price: 1_250_000, quota: 3000, sortOrder: 1 },
    { id: "demo-tribun", name: "Tribun", price: 850_000, quota: 1500, sortOrder: 2 },
    { id: "demo-vip", name: "VIP", price: 3_500_000, quota: 500, sortOrder: 3 },
  ];

  for (const category of categories) {
    await prisma.ticketCategory.upsert({
      where: { id: category.id },
      update: {
        name: category.name,
        price: category.price,
        quota: category.quota,
        sortOrder: category.sortOrder,
      },
      create: { ...category, eventId: DEMO_EVENT_ID },
    });
  }

  console.log(
    `Seed selesai: event ${DEMO_EVENT_ID}, ruang tunggu ${eventData.preQueueAt.toISOString()}, penjualan ${eventData.saleOpensAt.toISOString()}`,
  );
}

main()
  .catch((error: Error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
