import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  // PrismaNeon (7.8) takes a PoolConfig and creates the @neondatabase/serverless
  // Pool internally on connect(). This is the Neon-recommended adapter for
  // Prisma 7's `engineType = "client"` default.
  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: ["query", "error", "warn"],
  });
}

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
