// M8c checkpoint (Task 11.4).
//
// End-to-end demoable flow exercising the design §5.3 post-freeze write
// path against the seeded "esp32-sensor-breakout" v1 BRINGUP revision.
// Three observable scenarios (all driven through the real action layer,
// against the real DB):
//
//   1. Erratum on the seeded BRINGUP (not-yet-frozen) revision → success.
//   2. Freeze the revision (cascading the active Build's freeze the same
//      way advanceStage does on BRINGUP → REVISION). Then create another
//      erratum on the now-FROZEN revision → success (the post-freeze
//      write path).
//   3. Create a sibling revision under the same project; verify the first
//      erratum can be linked to it (same-project link succeeds). Then
//      create a foreign-project revision and verify cross-project link is
//      rejected with the canonical message.
//
// Mutations are bounded to test-created rows (and the seed BUILD's
// frozenAt/Revision freeze fields are restored in afterAll) so the M7
// demo and the M8a checkpoint still pass.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import { db } from "@/lib/db";
import {
  createErratum,
  linkErratumToRevision,
} from "@/lib/actions/errata";
import { CROSS_PROJECT_ERRATUM_MSG } from "@/lib/schemas/erratum";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdErratumIds: string[] = [];
const createdRevisionIds: string[] = [];
const createdProjectIds: string[] = [];

// Original freeze state on the seeded v1 + BUILD-001 so we can restore.
let originalRevFrozenAt: Date | null = null;
let originalRevFrozenById: string | null = null;
let originalBuildFrozenAt: Date | null = null;
let seededRevId = "";
let seededBuildId = "";

beforeAll(async () => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));

  const project = await db.project.findUniqueOrThrow({
    where: { slug: SEED_PROJECT_SLUG },
  });
  const rev = await db.revision.findFirstOrThrow({
    where: {
      projectId: project.id,
      label: { equals: "v1", mode: "insensitive" },
    },
  });
  const build = await db.build.findFirstOrThrow({
    where: { revisionId: rev.id },
  });
  seededRevId = rev.id;
  seededBuildId = build.id;
  originalRevFrozenAt = rev.frozenAt;
  originalRevFrozenById = rev.frozenById;
  originalBuildFrozenAt = build.frozenAt;
});

afterAll(async () => {
  if (createdErratumIds.length > 0) {
    await db.erratum.deleteMany({
      where: { id: { in: createdErratumIds } },
    });
  }
  if (createdRevisionIds.length > 0) {
    await db.revision.deleteMany({
      where: { id: { in: createdRevisionIds } },
    });
  }
  if (createdProjectIds.length > 0) {
    await db.project.deleteMany({
      where: { id: { in: createdProjectIds } },
    });
  }
  // Restore seeded freeze state (if the freeze step ran).
  if (seededRevId) {
    await db.revision.update({
      where: { id: seededRevId },
      data: {
        frozenAt: originalRevFrozenAt,
        frozenById: originalRevFrozenById,
      },
    });
  }
  if (seededBuildId) {
    await db.build.update({
      where: { id: seededBuildId },
      data: { frozenAt: originalBuildFrozenAt },
    });
  }
});

describe("M8c checkpoint — erratum lifecycle on seeded esp32-sensor-breakout/v1", () => {
  test("step 1: erratum on the seeded BRINGUP (not-yet-frozen) revision → success", async () => {
    const seedRev = await db.revision.findUniqueOrThrow({
      where: { id: seededRevId },
    });
    // Sanity: starts not frozen (the seed leaves the rev at BRINGUP).
    expect(seedRev.frozenAt).toBeNull();

    const e = await createErratum({
      revisionId: seedRev.id,
      title: "M8c step 1 — pre-freeze erratum",
      description:
        "Captured during BRINGUP before freeze; standard write path.",
      severity: "MINOR",
    });
    createdErratumIds.push(e.id);

    expect(e.revisionId).toBe(seedRev.id);
    expect(e.severity).toBe("MINOR");
    expect(e.status).toBe("OPEN");
  });

  test("step 2: freeze the rev (cascade to BUILD-001), then create a second erratum → success", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { email: SEED_EMAIL },
    });
    // Cascade the freeze the same way advanceStage does on BRINGUP → REVISION
    // (design §5.3 + §5.4): rev.frozenAt + rev.frozenById, AND the active
    // Build's frozenAt in the same logical step.
    const now = new Date();
    await db.revision.update({
      where: { id: seededRevId },
      data: {
        frozenAt: now,
        frozenById: user.id,
      },
    });
    await db.build.update({
      where: { id: seededBuildId },
      data: { frozenAt: now },
    });

    // Verify the freeze took.
    const after = await db.revision.findUniqueOrThrow({
      where: { id: seededRevId },
    });
    expect(after.frozenAt).not.toBeNull();

    // Now: the canonical post-freeze write path test. createErratum MUST
    // succeed on a frozen rev — that's why erratum CRUD bypasses
    // assertNotFrozen per design §5.3.
    const e = await createErratum({
      revisionId: seededRevId,
      title: "M8c step 2 — post-freeze erratum",
      description:
        "Captured AFTER freeze. Errata are the post-freeze write path (design §5.3).",
      severity: "BLOCKER",
    });
    createdErratumIds.push(e.id);

    expect(e.revisionId).toBe(seededRevId);
    expect(e.severity).toBe("BLOCKER");
  });

  test("step 3a: linking the step-1 erratum to a same-project sibling rev → success", async () => {
    // Create a sibling rev under the seeded project. It's allowed even though
    // the seeded v1 is frozen — we only freeze v1, not the project.
    const project = await db.project.findUniqueOrThrow({
      where: { slug: SEED_PROJECT_SLUG },
    });
    const sibling = await db.revision.create({
      data: {
        projectId: project.id,
        label: `m8c-sibling-${Date.now()}`,
        currentStage: "REQUIREMENTS",
      },
    });
    createdRevisionIds.push(sibling.id);

    // Pick an erratum we know is on the seeded rev — the one from step 1.
    const erratum = await db.erratum.findFirstOrThrow({
      where: {
        revisionId: seededRevId,
        title: "M8c step 1 — pre-freeze erratum",
      },
    });

    const linked = await linkErratumToRevision({
      id: erratum.id,
      addressedByRevisionId: sibling.id,
    });

    expect(linked.addressedByRevisionId).toBe(sibling.id);
  });

  test("step 3b: linking to a foreign-project revision → rejected with canonical message", async () => {
    // Spin up a foreign project + rev to attempt the cross-project link.
    const user = await db.user.findUniqueOrThrow({
      where: { email: SEED_EMAIL },
    });
    const foreignProject = await db.project.create({
      data: {
        slug: `m8c-foreign-${Date.now()}`,
        name: "m8c foreign project",
        createdById: user.id,
      },
    });
    createdProjectIds.push(foreignProject.id);

    const foreignRev = await db.revision.create({
      data: {
        projectId: foreignProject.id,
        label: "v1",
        currentStage: "REQUIREMENTS",
      },
    });
    createdRevisionIds.push(foreignRev.id);

    // Pick any erratum on the seeded rev.
    const erratum = await db.erratum.findFirstOrThrow({
      where: { revisionId: seededRevId },
    });

    await expect(
      linkErratumToRevision({
        id: erratum.id,
        addressedByRevisionId: foreignRev.id,
      }),
    ).rejects.toThrow(CROSS_PROJECT_ERRATUM_MSG);
  });
});
