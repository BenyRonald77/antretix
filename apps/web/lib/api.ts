import { apiErrorSchema } from "@antretix/shared";
import type { z } from "zod";
import { readStorage, writeStorage } from "./storage";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const TOKEN_KEY = "antretix.token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;

  constructor(status: number, code: string, message: string, retryAfterSec: number | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function readToken(): string | null {
  return readStorage("local", TOKEN_KEY);
}

export function writeToken(token: string | null): void {
  writeStorage("local", TOKEN_KEY, token);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
  /** Terima status non-2xx tertentu sebagai respons normal (mis. 410 SOLD_OUT yang tetap membawa body). */
  acceptStatus?: readonly number[];
}

/** Semua respons API di-parse dengan skema Zod dari @antretix/shared di sini, satu kali. */
export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const headers = new Headers(options.headers);
  const token = readToken();

  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
      null,
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok && !(options.acceptStatus ?? []).includes(response.status)) {
    const parsed = apiErrorSchema.safeParse(payload);
    const retryAfter = response.headers.get("retry-after");

    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.code : "HTTP_ERROR",
      parsed.success ? parsed.data.message : `Server membalas ${response.status}`,
      retryAfter === null ? null : Number(retryAfter),
    );
  }

  return schema.parse(payload);
}

export function jsonBody(value: Record<string, string | number | boolean | undefined>): string {
  return JSON.stringify(value);
}
