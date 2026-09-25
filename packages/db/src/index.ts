import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient, OrderStatus, EventStatus, Role } from "@prisma/client";

export type { User, Event, TicketCategory, Order, OrderItem, Ticket } from "@prisma/client";

export { hashPassword, verifyPassword } from "./password";

export function createPrisma(databaseUrl?: string): PrismaClient {
  if (databaseUrl === undefined) {
    return new PrismaClient();
  }

  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export const DEMO_EVENT_ID = "demo-konser";
