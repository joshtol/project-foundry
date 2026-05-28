// Prisma 7 config — connection URLs live here, not in schema.prisma.
// Load .env.local (authoritative) — we do not use a root .env file.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma Migrate uses the direct (non-pooled) URL to support advisory locks.
    // Runtime PrismaClient reads DATABASE_URL (pooled) from env separately.
    url: process.env["DIRECT_URL"],
  },
});
