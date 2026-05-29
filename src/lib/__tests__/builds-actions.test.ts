// Tests for Build server actions (Task 6.1 + 6.3).
//
// createBuild covers:
//   - Happy path from DRC_GERBER (no regress; no StageTransition row added).
//   - Happy path from BRINGUP (single REGRESS row; revision now at ORDERING).
//   - Rejection: an unfrozen Build already exists (Phase 1 invariant).
//   - Rejection: revision is frozen.
//   - Rejection: revision at SCHEMATIC (stage too early).
//   - Concurrency: two parallel createBuilds — exactly one survives.
//
// editBuild covers:
//   - Edit succeeds on unfrozen Build.
//   - Edit fails when Build is frozen.
//   - Edit fails when parent Revision is frozen.
//
// The seed gives us BUILD-001 on the v1 BRINGUP revision with all 5 boards
// ASSEMBLED. We make throwaway revisions/projects for the createBuild tests
// because the seeded rev already has BUILD-001 unfrozen — perfect for the
// "rejected" case but not for happy-path.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createBuild, editBuild } from "@/lib/actions/builds";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdBuildIds: string[] = [];
const createdRevisionIds: string[] = [];
const createdProjectIds: string[] = [];

beforeAll(() => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));
});

afterAll(async () => {
  // Builds cascade via Revision. We still delete them explicitly to be safe
  // because some tests freeze them.
  if (createdBuildIds.length > 0) {
    await db.build.deleteMany({
      where: { id: { in: createdBuildIds } },
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
});

async function seedUser() {
  return db.user.findUniqueOrThrow({ where: { email: SEED_EMAIL } });
}

/**
 * Make a throwaway revision at a specific stage, bypassing live gates. This
 * is the M2b-seed trapdoor pattern (§12.1) — we write `currentStage` directly
 * since we're bootstrapping the test fixture, not exercising the state
 * machine.
 */
async function makeRevAtStage(
  stage:
    | "REQUIREMENTS"
    | "SCHEMATIC"
    | "BOM_SOURCING"
    | "LAYOUT"
    | "DRC_GERBER"
    | "ORDERING"
    | "ASSEMBLY"
    | "BRINGUP"
    | "REVISION",
  label: string,
): Promise<{ id: string; projectId: string }> {
  const user = await seedUser();
  const project = await db.project.findUniqueOrThrow({
    where: { slug: SEED_PROJECT_SLUG },
  });
  const rev = await db.revision.create({
    data: {
      projectId: project.id,
      label,
      currentStage: stage,
    },
  });
  createdRevisionIds.push(rev.id);
  // INIT row so the transitions table isn't an outlier; we may assert on it.
  await db.stageTransition.create({
    data: {
      revisionId: rev.id,
      fromStage: null,
      toStage: "REQUIREMENTS",
      direction: "INIT",
      gateSnapshot: {
        v: 1,
        kind: "init",
        ts: new Date().toISOString(),
      },
      transitionedBy: user.id,
    },
  });
  return { id: rev.id, projectId: project.id };
}

describe("createBuild — stage permissions and side-effects", () => {
  test("from DRC_GERBER: succeeds with no extra StageTransition row", async () => {
    const rev = await makeRevAtStage(
      "DRC_GERBER",
      `t6.1-drc-${Date.now()}`,
    );
    const transitionsBefore = await db.stageTransition.count({
      where: { revisionId: rev.id },
    });

    const build = await createBuild({
      revisionId: rev.id,
      label: `BUILD-DRC-${Date.now()}`,
      boardCount: 4,
    });
    createdBuildIds.push(build.id);

    expect(build.boardCount).toBe(4);
    expect(build.revisionId).toBe(rev.id);
    expect(build.frozenAt).toBeNull();

    const transitionsAfter = await db.stageTransition.count({
      where: { revisionId: rev.id },
    });
    expect(transitionsAfter).toBe(transitionsBefore);

    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("DRC_GERBER");
  });

  test("from BRINGUP: regresses to ORDERING with a single REGRESS row", async () => {
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t6.1-bringup-${Date.now()}`,
    );
    const transitionsBefore = await db.stageTransition.count({
      where: { revisionId: rev.id },
    });

    const label = `BUILD-BR-${Date.now()}`;
    const build = await createBuild({
      revisionId: rev.id,
      label,
      boardCount: 3,
    });
    createdBuildIds.push(build.id);

    // Exactly one new transition.
    const transitionsAfter = await db.stageTransition.findMany({
      where: { revisionId: rev.id },
      orderBy: { transitionedAt: "asc" },
    });
    expect(transitionsAfter).toHaveLength(transitionsBefore + 1);

    const regress = transitionsAfter[transitionsAfter.length - 1];
    expect(regress?.direction).toBe("REGRESS");
    expect(regress?.fromStage).toBe("BRINGUP");
    expect(regress?.toStage).toBe("ORDERING");
    expect(regress?.notes).toBe(`New Build ${label} created`);
    const snap = regress?.gateSnapshot as {
      v: number;
      kind: string;
      reason: string;
      ts: string;
    };
    expect(snap.v).toBe(1);
    expect(snap.kind).toBe("regress");
    expect(snap.reason).toBe(`New Build ${label} created`);
    expect(typeof snap.ts).toBe("string");

    // Revision now at ORDERING.
    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("ORDERING");
  });
});

describe("createBuild — rejection paths", () => {
  test("rejects when an unfrozen Build already exists", async () => {
    const rev = await makeRevAtStage(
      "ASSEMBLY",
      `t6.1-dup-${Date.now()}`,
    );
    const first = await createBuild({
      revisionId: rev.id,
      label: `BUILD-DUP-A-${Date.now()}`,
      boardCount: 2,
    });
    createdBuildIds.push(first.id);

    await expect(
      createBuild({
        revisionId: rev.id,
        label: `BUILD-DUP-B-${Date.now()}`,
        boardCount: 2,
      }),
    ).rejects.toThrow(/unfrozen Build/i);
  });

  test("rejects when the revision is frozen", async () => {
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t6.1-frz-${Date.now()}`,
    );
    const user = await seedUser();
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      createBuild({
        revisionId: rev.id,
        label: `BUILD-FRZ-${Date.now()}`,
        boardCount: 1,
      }),
    ).rejects.toThrow(/frozen/i);
  });

  test("rejects when stage is SCHEMATIC (too early)", async () => {
    const rev = await makeRevAtStage(
      "SCHEMATIC",
      `t6.1-sch-${Date.now()}`,
    );
    await expect(
      createBuild({
        revisionId: rev.id,
        label: `BUILD-SCH-${Date.now()}`,
        boardCount: 1,
      }),
    ).rejects.toThrow(/Cannot create Build at stage SCHEMATIC/);
  });
});

describe("createBuild — concurrent attempts on the same Revision", () => {
  test("two parallel inserts: exactly one survives", async () => {
    const rev = await makeRevAtStage(
      "ASSEMBLY",
      `t6.1-conc-${Date.now()}`,
    );

    const labelA = `BUILD-CC-A-${Date.now()}`;
    const labelB = `BUILD-CC-B-${Date.now() + 1}`;

    const results = await Promise.allSettled([
      createBuild({ revisionId: rev.id, label: labelA, boardCount: 2 }),
      createBuild({ revisionId: rev.id, label: labelB, boardCount: 2 }),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ id: string }>[];
    const rejected = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const survivor = fulfilled[0]?.value;
    if (survivor) createdBuildIds.push(survivor.id);

    // Whatever surfaced, it should look like the DB/app refusing a duplicate
    // unfrozen Build: either the friendly app message, the partial unique
    // index violation, or an SSI serialization_failure (40001).
    const err = String(rejected[0].reason?.message ?? rejected[0].reason);
    expect(err).toMatch(
      /unfrozen Build|build_one_unfrozen_per_revision|unique|serialization|40001/i,
    );

    // Steady-state invariant: exactly one unfrozen Build on this revision.
    const unfrozen = await db.build.findMany({
      where: { revisionId: rev.id, frozenAt: null },
    });
    expect(unfrozen).toHaveLength(1);
  });
});

describe("editBuild — freeze policy", () => {
  test("succeeds when Build is unfrozen and revision is unfrozen", async () => {
    const rev = await makeRevAtStage(
      "ASSEMBLY",
      `t6.3-edit-${Date.now()}`,
    );
    const build = await createBuild({
      revisionId: rev.id,
      label: `BUILD-EDIT-${Date.now()}`,
      boardCount: 2,
    });
    createdBuildIds.push(build.id);

    const updated = await editBuild({
      id: build.id,
      pcbOrderRef: "OSH-9001",
      partsOrderRef: "DK-9001",
      orderedAt: new Date("2026-05-01"),
    });
    expect(updated.pcbOrderRef).toBe("OSH-9001");
    expect(updated.partsOrderRef).toBe("DK-9001");
    expect(updated.orderedAt?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  test("fails when Build is frozen", async () => {
    const rev = await makeRevAtStage(
      "ASSEMBLY",
      `t6.3-edit-frzb-${Date.now()}`,
    );
    const build = await createBuild({
      revisionId: rev.id,
      label: `BUILD-EFB-${Date.now()}`,
      boardCount: 1,
    });
    createdBuildIds.push(build.id);

    await db.build.update({
      where: { id: build.id },
      data: { frozenAt: new Date() },
    });

    await expect(
      editBuild({ id: build.id, pcbOrderRef: "X" }),
    ).rejects.toThrow(/Build is frozen/i);
  });

  test("fails when parent Revision is frozen", async () => {
    const rev = await makeRevAtStage(
      "ASSEMBLY",
      `t6.3-edit-frzr-${Date.now()}`,
    );
    const build = await createBuild({
      revisionId: rev.id,
      label: `BUILD-EFR-${Date.now()}`,
      boardCount: 1,
    });
    createdBuildIds.push(build.id);

    const user = await seedUser();
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      editBuild({ id: build.id, pcbOrderRef: "X" }),
    ).rejects.toThrow(/Revision is frozen/i);
  });
});

// Quiet "Prisma is imported but unused" linter — we keep the import in case
// future tests reach for its enums.
void Prisma;
