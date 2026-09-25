import { hashPassword, verifyPassword } from "@antretix/db";
import { AppError, devLoginSchema, loginSchema, registerSchema } from "@antretix/shared";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app";
import { requireUser, signAuthToken, type AuthUser } from "../auth";

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "ADMIN";
}): AuthUser {
  return { sub: user.id, email: user.email, name: user.name, role: user.role };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma } = deps.ctx;

  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing !== null) {
      throw new AppError("CONFLICT", "Email sudah terdaftar");
    }

    // IP pendaftar dicatat agar admin bisa meninjau IP yang membuat banyak akun (tanpa blokir otomatis).
    const user = await prisma.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        signupIp: request.ip,
      },
    });

    const authUser = toAuthUser(user);

    return reply.status(201).send({ token: signAuthToken(app, authUser), user: authUser });
  });

  app.post("/auth/login", async (request) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

    if (
      user === null ||
      user.passwordHash === null ||
      !(await verifyPassword(input.password, user.passwordHash))
    ) {
      throw new AppError("UNAUTHORIZED", "Email atau password salah");
    }

    const authUser = toAuthUser(user);

    return { token: signAuthToken(app, authUser), user: authUser };
  });

  // Login tanpa password, hanya aktif di mode load test agar k6 bisa membuat ribuan akun dengan cepat.
  if (deps.env.LOADTEST_MODE) {
    app.post("/auth/dev-login", async (request) => {
      const input = devLoginSchema.parse(request.body);
      const email = input.email.toLowerCase();

      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: email.split("@")[0] ?? "loadtest", signupIp: request.ip },
      });

      const authUser = toAuthUser(user);

      return { token: signAuthToken(app, authUser), user: authUser };
    });
  }

  app.get("/auth/me", async (request) => ({ user: requireUser(request) }));
}
