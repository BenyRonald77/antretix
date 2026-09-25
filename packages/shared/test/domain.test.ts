import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkPerUserLimit,
  estimateWait,
  formatEta,
  holdsTickets,
  observedThroughput,
} from "../src";

describe("ETA", () => {
  it("memakai throughput aktual bila ada", () => {
    expect(estimateWait(600, 10, 50)).toEqual({ minSec: 48, maxSec: 72 });
  });

  it("jatuh ke laju konfigurasi bila belum ada throughput", () => {
    expect(estimateWait(100, 0, 50)).toEqual({ minSec: 1, maxSec: 3 });
  });

  it("tidak bisa diperkirakan bila antrean tidak bergerak sama sekali", () => {
    expect(estimateWait(100, 0, 0)).toBeNull();
  });

  it("posisi 0 berarti tidak perlu menunggu", () => {
    expect(estimateWait(0, 5, 5)).toEqual({ minSec: 0, maxSec: 0 });
  });

  it("throughput = total admit dalam jendela / panjang jendela", () => {
    expect(observedThroughput([50, 50, 20], 60)).toBe(2);
    expect(observedThroughput([10], 0)).toBe(0);
  });

  it("ditampilkan sebagai rentang, bukan angka pasti", () => {
    expect(formatEta({ minSec: 240, maxSec: 360 })).toBe("sekitar 4–6 menit");
    expect(formatEta({ minSec: 10, maxSec: 20 })).toBe("kurang dari 1 menit");
    expect(formatEta(null)).toBe("menunggu antrean bergerak");
  });
});

describe("batas tiket per akun", () => {
  it("menghitung lintas order", () => {
    expect(checkPerUserLimit(0, 4, 4)).toBe("OK");
    expect(checkPerUserLimit(2, 3, 4)).toBe("LIMIT_EXCEEDED");
    expect(checkPerUserLimit(0, 0, 4)).toBe("INVALID_QTY");
    expect(checkPerUserLimit(0, 1.5, 4)).toBe("INVALID_QTY");
  });
});

describe("transisi status order", () => {
  it("hanya transisi yang sah diizinkan", () => {
    expect(canTransition("PENDING", "PAID")).toBe(true);
    expect(canTransition("PENDING", "EXPIRED")).toBe(true);
    expect(canTransition("EXPIRED", "REFUNDED")).toBe(true);
    expect(canTransition("EXPIRED", "PAID")).toBe(false);
    expect(canTransition("PAID", "EXPIRED")).toBe(false);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
  });

  it("hanya PENDING dan PAID yang memegang kuota", () => {
    expect(holdsTickets("PENDING")).toBe(true);
    expect(holdsTickets("PAID")).toBe(true);
    expect(holdsTickets("EXPIRED")).toBe(false);
    expect(holdsTickets("REFUNDED")).toBe(false);
  });
});
