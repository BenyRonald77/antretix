import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH);

  // SAFETY: promisify(scrypt) tanpa opsi selalu menghasilkan Buffer.
  return `${salt}:${(derived as Buffer).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");

  if (salt === undefined || hash === undefined) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH);

  // SAFETY: promisify(scrypt) tanpa opsi selalu menghasilkan Buffer.
  const actual = derived as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
