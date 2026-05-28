// Seed runner. Bypasses the live gate engine and writes rows directly
// (documented seed-trapdoor per design §5.3). Idempotent: upserts everywhere.
//
// Run via `pnpm db:seed` (which runs `prisma db seed`, which honors the
// `prisma.seed` script in package.json).
import { config as loadEnv } from "dotenv";

// Load .env.local before importing anything that reads process.env.DATABASE_URL.
loadEnv({ path: ".env.local" });

import { db } from "@/lib/db";

async function main() {
  console.log("seed: starting");
  // populated in subsequent tasks
  console.log("seed: complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
