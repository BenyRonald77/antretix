import { randomBytes } from "node:crypto";

// Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let code = "";

  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }

  return code;
}

export function newOrderCode(): string {
  return `ATX-${randomCode(8)}`;
}

/** Kode tiket (isi QR): 20 karakter acak, tidak bisa ditebak. */
export function newTicketCode(): string {
  return `TIX-${randomCode(20)}`;
}
