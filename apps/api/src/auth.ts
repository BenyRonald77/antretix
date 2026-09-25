import { AppError } from "@antretix/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createSigner, createVerifier } from "fast-jwt";
import { z } from "zod";
import type { QueueTokenClaims, QueueTokenSigner } from "@antretix/core";

export const authUserSchema = z.object({
  sub: z.string().min(1),
  email: z.string(),
  name: z.string(),
  role: z.enum(["CUSTOMER", "ADMIN"]),
});

export type AuthUser = z.infer<typeof authUserSchema>;

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

const AUTH_TOKEN_TTL = "7d";

export function signAuthToken(app: FastifyInstance, user: AuthUser): string {
  return app.jwt.sign(user, { expiresIn: AUTH_TOKEN_TTL });
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (header !== undefined && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  return null;
}

/** Membaca token login dari header Authorization (atau ?access_token= khusus SSE, karena EventSource tidak bisa mengirim header). */
export function readAuthUser(
  app: FastifyInstance,
  request: FastifyRequest,
  allowQueryToken: boolean,
): AuthUser | null {
  let token = bearerToken(request);

  if (token === null && allowQueryToken) {
    const query = z.object({ access_token: z.string().optional() }).safeParse(request.query);

    token = query.success ? (query.data.access_token ?? null) : null;
  }

  if (token === null) {
    return null;
  }

  try {
    const parsed = authUserSchema.safeParse(app.jwt.verify(token));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (request.authUser === null) {
    throw new AppError("UNAUTHORIZED", "Silakan login terlebih dahulu");
  }

  return request.authUser;
}

export function requireAdmin(request: FastifyRequest): AuthUser {
  const user = requireUser(request);

  if (user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Hanya admin yang boleh mengakses endpoint ini");
  }

  return user;
}

const queueClaimsSchema = z.object({
  sub: z.string(),
  eid: z.string(),
  typ: z.literal("queue"),
  exp: z.number(),
});

export interface QueueTokens {
  sign: QueueTokenSigner;
  verify: (token: string) => QueueTokenClaims | null;
}

/**
 * Access token antrean: JWT HS256 berisi userId, eventId, dan exp (= akhir sesi aktif, maks. 10 menit).
 * Secret-nya terpisah dari token login agar token login tidak bisa dipakai sebagai tiket masuk checkout.
 */
export function createQueueTokens(secret: string): QueueTokens {
  const signer = createSigner({ key: secret, algorithm: "HS256" });
  const verifier = createVerifier({ key: secret, algorithms: ["HS256"] });

  return {
    sign: (claims) =>
      signer({
        sub: claims.userId,
        eid: claims.eventId,
        typ: "queue",
        exp: Math.floor(claims.expiresAtMs / 1000),
      }),
    verify: (token) => {
      try {
        const parsed = queueClaimsSchema.safeParse(verifier(token));

        if (!parsed.success) {
          return null;
        }

        return {
          userId: parsed.data.sub,
          eventId: parsed.data.eid,
          expiresAtMs: parsed.data.exp * 1000,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Semua endpoint checkout menolak request tanpa token antrean yang sah untuk akun dan event yang sama. */
export function requireQueueToken(
  tokens: QueueTokens,
  request: FastifyRequest,
  eventId: string,
  userId: string,
): QueueTokenClaims {
  const header = request.headers["x-queue-token"];
  const token = Array.isArray(header) ? header[0] : header;

  if (token === undefined || token.length === 0) {
    throw new AppError(
      "QUEUE_TOKEN_REQUIRED",
      "Anda harus melewati antrean untuk mengakses checkout",
    );
  }

  const claims = tokens.verify(token);

  if (claims === null || claims.eventId !== eventId || claims.userId !== userId) {
    throw new AppError("QUEUE_TOKEN_REQUIRED", "Token antrean tidak valid atau sudah kedaluwarsa");
  }

  return claims;
}
