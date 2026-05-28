// Seed runner. Bypasses the live gate engine and writes rows directly
// (documented seed-trapdoor per design §5.3). Idempotent: upserts everywhere.
//
// Run via `pnpm db:seed` (which runs `prisma db seed`, which honors the
// `migrations.seed` field in prisma.config.ts).
import { config as loadEnv } from "dotenv";

// Load .env.local before importing anything that reads process.env.DATABASE_URL.
loadEnv({ path: ".env.local" });

import { db } from "@/lib/db";

async function main() {
  console.log("seed: starting");

  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: "seed@example.com" },
      update: {},
      create: { email: "seed@example.com", name: "Seed User" },
    });

    const project = await tx.project.upsert({
      where: { slug: "esp32-sensor-breakout" },
      update: {},
      create: {
        slug: "esp32-sensor-breakout",
        name: "ESP32 sensor breakout",
        description: "Reference ESP32-S3 breakout with I2C sensor headers.",
        createdById: user.id,
      },
    });

    // Revision has no Prisma compound-unique (uniqueness is the raw
    // functional index revision_project_label_ci on (projectId, lower(label))).
    // Use findFirst + create-or-update to stay idempotent.
    const existingRevision = await tx.revision.findFirst({
      where: { projectId: project.id, label: { equals: "v1", mode: "insensitive" } },
    });
    const revision = existingRevision
      ? await tx.revision.update({
          where: { id: existingRevision.id },
          data: {
            currentStage: "BRINGUP",
            schematicCommit: "g1ebc1cc",
            layoutCommit: "gb170ddb",
          },
        })
      : await tx.revision.create({
          data: {
            projectId: project.id,
            label: "v1",
            currentStage: "BRINGUP",
            schematicCommit: "g1ebc1cc",
            layoutCommit: "gb170ddb",
          },
        });

    console.log(`seed: user=${user.id} project=${project.id} revision=${revision.id}`);
  });

  console.log("seed: complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
