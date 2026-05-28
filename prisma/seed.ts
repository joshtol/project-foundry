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

    // ─── Parts library + BOM ────────────────────────────
    const partSpecs = [
      {
        manufacturer: "Espressif",
        mpn: "ESP32-S3-WROOM-1-N16R8",
        description: "ESP32-S3 SoC module, 16 MB flash, 8 MB PSRAM",
        category: "MCU",
        footprint: "ESP32-WROOM",
        datasheetUrl: "https://www.example.com/ESP32-S3-WROOM-1-N16R8.pdf",
        refDes: "U1",
        quantity: 1,
      },
      {
        manufacturer: "Microchip",
        mpn: "MCP73831T-2ACI/OT",
        description: "Single-cell Li-ion/Li-Po charge management controller, SOT-23-5",
        category: "PMIC",
        footprint: "SOT-23-5",
        datasheetUrl: "https://www.example.com/MCP73831T-2ACI-OT.pdf",
        refDes: "U2",
        quantity: 1,
      },
      {
        manufacturer: "Bosch",
        mpn: "BME280",
        description: "Combined humidity, pressure, and temperature sensor, LGA-8",
        category: "Sensor",
        footprint: "LGA-8",
        datasheetUrl: "https://www.example.com/BME280.pdf",
        refDes: "U3",
        quantity: 1,
      },
    ] as const;

    for (const spec of partSpecs) {
      const part = await tx.part.upsert({
        where: { manufacturer_mpn: { manufacturer: spec.manufacturer, mpn: spec.mpn } },
        update: {},
        create: {
          manufacturer: spec.manufacturer,
          mpn: spec.mpn,
          description: spec.description,
          category: spec.category,
          footprint: spec.footprint,
          datasheetUrl: spec.datasheetUrl,
          lifecycle: "ACTIVE",
          createdById: user.id,
        },
      });

      await tx.bomLine.upsert({
        where: { revisionId_partId: { revisionId: revision.id, partId: part.id } },
        update: {},
        create: {
          revisionId: revision.id,
          partId: part.id,
          refDes: spec.refDes,
          quantity: spec.quantity,
          createdById: user.id,
        },
      });
    }

    // ─── Build BUILD-001 + 5 boards ─────────────────────
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    // Build has no compound-unique in Prisma (raw functional index only).
    const existingBuild = await tx.build.findFirst({
      where: { revisionId: revision.id, label: { equals: "BUILD-001", mode: "insensitive" } },
    });
    const build = existingBuild
      ? await tx.build.update({
          where: { id: existingBuild.id },
          data: {
            boardCount: 5,
            pcbOrderRef: "OSH-1234",
            partsOrderRef: "DK-5678",
            orderedAt: daysAgo(10),
            receivedAt: daysAgo(5),
            assemblyStartedAt: daysAgo(4),
            frozenAt: null,
          },
        })
      : await tx.build.create({
          data: {
            revisionId: revision.id,
            label: "BUILD-001",
            boardCount: 5,
            pcbOrderRef: "OSH-1234",
            partsOrderRef: "DK-5678",
            orderedAt: daysAgo(10),
            receivedAt: daysAgo(5),
            assemblyStartedAt: daysAgo(4),
            createdById: user.id,
          },
        });

    for (const serial of ["B01", "B02", "B03", "B04", "B05"]) {
      // Board uniqueness is raw functional index board_build_serial_ci only.
      const existingBoard = await tx.board.findFirst({
        where: { buildId: build.id, serial: { equals: serial, mode: "insensitive" } },
      });
      if (existingBoard) {
        await tx.board.update({
          where: { id: existingBoard.id },
          data: { status: "ASSEMBLED", silkscreenHash: "g1ebc1cc" },
        });
      } else {
        await tx.board.create({
          data: {
            buildId: build.id,
            serial,
            status: "ASSEMBLED",
            silkscreenHash: "g1ebc1cc",
          },
        });
      }
    }

    console.log(`seed: build=${build.id}`);

    // ─── Build-scoped artifacts (NOTE kind only — no R2 needed) ───────
    // All BRINGUP stage; buildId set, revisionId null (XOR enforced by CHECK).
    const artifacts = [
      {
        subkind: "PCB_ORDER" as const,
        title: "OSH Park order OSH-1234",
        noteBody:
          "Submitted 2026-05-18; 5 boards Rev B; ENIG finish; arrived 2026-05-23.",
      },
      {
        subkind: "PARTS_ORDER" as const,
        title: "DigiKey order DK-5678",
        noteBody:
          "Submitted 2026-05-18; all components for 5 boards; arrived 2026-05-23.",
      },
      {
        subkind: "BRINGUP_LOG" as const,
        title: "Initial power-on B01",
        noteBody:
          "# Initial power-on B01\n\n" +
          "- Connected USB; observed 5.02 V on VBUS.\n" +
          "- 3V3 rail at 3.31 V (LDO healthy).\n" +
          "- ESP32 boot banner OK on serial console.\n" +
          "- No smoke, no excess current draw.\n",
      },
      {
        subkind: "BRINGUP_COMPLETE" as const,
        title: "Bring-up complete (seed-injected)",
        noteBody:
          "Seed-injected so M7 can demo BRINGUP→REVISION before M8a's Mark complete button ships.",
      },
    ];

    for (const a of artifacts) {
      // Artifact has no compound-unique; key idempotency on (buildId, subkind, title).
      const existing = await tx.artifact.findFirst({
        where: { buildId: build.id, subkind: a.subkind, title: a.title },
      });
      if (existing) {
        await tx.artifact.update({
          where: { id: existing.id },
          data: { noteBody: a.noteBody, stage: "BRINGUP", kind: "NOTE" },
        });
      } else {
        await tx.artifact.create({
          data: {
            buildId: build.id,
            revisionId: null,
            stage: "BRINGUP",
            kind: "NOTE",
            subkind: a.subkind,
            title: a.title,
            noteBody: a.noteBody,
            createdBy: user.id,
          },
        });
      }
    }
  });

  console.log("seed: complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
