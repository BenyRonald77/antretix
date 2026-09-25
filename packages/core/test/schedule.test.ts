import { describe, expect, it } from "vitest";
import {
  eventStatusFor,
  nextQueueStatus,
  scheduledQueueStatus,
  type EventMeta,
} from "../src/events";
import { mockPaymentPayload, signPayment, verifyPaymentSignature } from "../src/payments";

const base: EventMeta = {
  id: "e",
  name: "Uji",
  venue: "Venue",
  description: "",
  posterUrl: "",
  startsAt: new Date("2026-12-01T12:00:00Z"),
  saleOpensAt: new Date("2026-10-01T10:00:00Z"),
  preQueueAt: new Date("2026-10-01T09:30:00Z"),
  status: "SCHEDULED",
  admitPerSec: 50,
  maxActive: 500,
  maxPerUser: 4,
  categories: [],
  stockKeys: [],
};

describe("jadwal antrean", () => {
  it("mengikuti jam ruang tunggu, jam buka, dan jam konser", () => {
    expect(scheduledQueueStatus(base, new Date("2026-10-01T09:00:00Z"))).toBe("SCHEDULED");
    expect(scheduledQueueStatus(base, new Date("2026-10-01T09:45:00Z"))).toBe("PREQUEUE");
    expect(scheduledQueueStatus(base, new Date("2026-10-01T10:00:00Z"))).toBe("OPEN");
    expect(scheduledQueueStatus(base, new Date("2026-12-01T12:00:00Z"))).toBe("CLOSED");
    expect(
      scheduledQueueStatus({ ...base, status: "DRAFT" }, new Date("2026-10-01T10:00:00Z")),
    ).toBe("CLOSED");
  });

  it("pause dan sold out tidak ditimpa jadwal, kecuali event ditutup", () => {
    expect(nextQueueStatus("PAUSED", "OPEN")).toBe("PAUSED");
    expect(nextQueueStatus("SOLD_OUT", "OPEN")).toBe("SOLD_OUT");
    expect(nextQueueStatus("SOLD_OUT", "CLOSED")).toBe("CLOSED");
    expect(nextQueueStatus("PREQUEUE", "OPEN")).toBe("OPEN");
    expect(nextQueueStatus(null, "PREQUEUE")).toBe("PREQUEUE");
  });

  it("status event di DB diturunkan dari status antrean", () => {
    expect(eventStatusFor("OPEN", "SCHEDULED")).toBe("ON_SALE");
    expect(eventStatusFor("PAUSED", "ON_SALE")).toBe("ON_SALE");
    expect(eventStatusFor("SOLD_OUT", "ON_SALE")).toBe("SOLD_OUT");
    expect(eventStatusFor("CLOSED", "SOLD_OUT")).toBe("ENDED");
    expect(eventStatusFor("OPEN", "DRAFT")).toBe("DRAFT");
  });
});

describe("signature webhook", () => {
  it("menerima signature yang benar dan menolak yang diubah atau kedaluwarsa", () => {
    const payload = mockPaymentPayload("order-1", 100_000, true);
    const signature = signPayment(payload, "secret");

    expect(verifyPaymentSignature(payload, signature, "secret", payload.timestamp)).toBe(true);
    expect(
      verifyPaymentSignature({ ...payload, amount: 1 }, signature, "secret", payload.timestamp),
    ).toBe(false);
    expect(verifyPaymentSignature(payload, signature, "other-secret", payload.timestamp)).toBe(
      false,
    );
    expect(
      verifyPaymentSignature(payload, signature, "secret", payload.timestamp + 10 * 60_000),
    ).toBe(false);
  });
});
