// Tests for stage state-machine server actions (Task 8.1 + 8.2).
//
// Exercises the real Neon DB; mocks `next/cache` and `@/auth` per the
// repository's vitest mocking pattern.
//
// advanceStage covers:
//   - Happy path: gate passes → transition row written, currentStage +
//     currentStageEnteredAt bumped, fromStage set on the row.
//   - Side-effect: BOM_SOURCING → LAYOUT sets bomFrozenAt = NOW().
//   - Side-effect: BRINGUP → REVISION sets frozenAt + frozenById AND
//     cascades frozenAt to the active Build (Task 8.4).
//   - Rejection: gate fails → returns { ok: false, reasons } (does NOT
//     throw — the caller renders the reasons inline).
//   - Rejection: revision is frozen.
//   - Rejection: revision at REVISION (terminal).
//   - Concurrency: two parallel callers; one succeeds, one rejects with
//     "stale state — another user advanced this revision".
//
// regressStage covers:
//   - Happy path: previous stage written.
//   - Side-effect: LAYOUT → BOM_SOURCING clears bomFrozenAt.
//   - Side-effect: DRC_GERBER → LAYOUT preserves bomFrozenAt.
//   - Rejection: empty reason (Zod rejects).
//   - Rejection: cannot regress from REQUIREMENTS.
//   - Rejection: frozen revision.

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import type { Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { advanceStage, regressStage } from "@/lib/actions/stages";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdRevisionIds: string[] = [];
const createdBuildIds: string[] = [];
const createdArtifactIds: string[] = [];
const createdBoardIds: string[] = [];

beforeAll(() => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    await db.artifact.deleteMany({
      where: { id: { in: createdArtifactIds } },
    });
  }
  if (createdBoardIds.length > 0) {
    await db.board.deleteMany({ where: { id: { in: createdBoardIds } } });
  }
  if (createdBuildIds.length > 0) {
    await db.build.deleteMany({ where: { id: { in: createdBuildIds } } });
  }
  if (createdRevisionIds.length > 0) {
    await db.revision.deleteMany({
      where: { id: { in: createdRevisionIds } },
    });
  }
});

async function seedUser() {
  return db.user.findUniqueOrThrow({ where: { email: SEED_EMAIL } });
}

/**
 * Make a throwaway revision at a specific stage, bypassing live gates.
 * Same trapdoor pattern used in builds-actions.test.ts.
 */
async function makeRevAtStage(
  stage: Stage,
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

async function addRequirementsArtifact(revisionId: string) {
  const user = await seedUser();
  const art = await db.artifact.create({
    data: {
      revisionId,
      stage: "REQUIREMENTS",
      kind: "NOTE",
      subkind: "REQUIREMENTS_DOC",
      title: "Reqs",
      noteBody: "Requirements captured.",
      createdBy: user.id,
    },
  });
  createdArtifactIds.push(art.id);
  return art;
}

// ─── advanceStage tests ────────────────────────────────

describe("advanceStage — happy paths", () => {
  test("REQUIREMENTS → SCHEMATIC: writes ADVANCE transition row with from/to stages", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t8.1-adv-${Date.now()}`,
    );
    await addRequirementsArtifact(rev.id);

    const before = await db.stageTransition.count({
      where: { revisionId: rev.id },
    });

    const result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("SCHEMATIC");
    // currentStageEnteredAt bumped to "now" (within the last minute).
    expect(after.currentStageEnteredAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const transitions = await db.stageTransition.findMany({
      where: { revisionId: rev.id },
      orderBy: { transitionedAt: "asc" },
    });
    expect(transitions).toHaveLength(before + 1);
    const last = transitions[transitions.length - 1]!;
    expect(last.direction).toBe("ADVANCE");
    expect(last.fromStage).toBe("REQUIREMENTS");
    expect(last.toStage).toBe("SCHEMATIC");
    const snap = last.gateSnapshot as {
      v: number;
      kind: string;
      result: { ok: boolean };
      ts: string;
    };
    expect(snap.v).toBe(1);
    expect(snap.kind).toBe("gate");
    expect(snap.result.ok).toBe(true);
    expect(typeof snap.ts).toBe("string");
  });

  test("BOM_SOURCING → LAYOUT: sets bomFrozenAt = NOW() on the revision", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "BOM_SOURCING",
      `t8.1-bomfreeze-${Date.now()}`,
    );

    // BOM_SOURCING gate requires bomLines with parts having datasheets and
    // not EOL/OBSOLETE. Use the seeded parts (already meet the criteria).
    const parts = await db.part.findMany({
      where: { lifecycle: "ACTIVE" },
      take: 1,
    });
    expect(parts.length).toBeGreaterThan(0);
    const part = parts[0]!;
    const line = await db.bomLine.create({
      data: {
        revisionId: rev.id,
        partId: part.id,
        refDes: "U1",
        quantity: 1,
        createdById: user.id,
      },
    });

    const result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(true);

    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("LAYOUT");
    expect(after.bomFrozenAt).not.toBeNull();
    expect(after.bomFrozenAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);

    // Clean up the BomLine (rev cascade handles it, but be defensive).
    await db.bomLine.delete({ where: { id: line.id } }).catch(() => {});
  });

  test("BRINGUP → REVISION: sets frozenAt + frozenById, cascades frozenAt to active Build", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t8.1-revfreeze-${Date.now()}`,
    );

    // Create an active Build with one BROUGHT_UP board + both BRINGUP
    // artifacts so the BRINGUP gate passes.
    const build = await db.build.create({
      data: {
        revisionId: rev.id,
        label: `BUILD-FREEZE-${Date.now()}`,
        boardCount: 1,
        createdById: user.id,
      },
    });
    createdBuildIds.push(build.id);

    const board = await db.board.create({
      data: {
        buildId: build.id,
        serial: "B01",
        status: "BROUGHT_UP",
      },
    });
    createdBoardIds.push(board.id);

    const log = await db.artifact.create({
      data: {
        buildId: build.id,
        stage: "BRINGUP",
        kind: "NOTE",
        subkind: "BRINGUP_LOG",
        title: "log",
        noteBody: "log",
        createdBy: user.id,
      },
    });
    createdArtifactIds.push(log.id);
    const complete = await db.artifact.create({
      data: {
        buildId: build.id,
        stage: "BRINGUP",
        kind: "NOTE",
        subkind: "BRINGUP_COMPLETE",
        title: "complete",
        noteBody: "complete",
        createdBy: user.id,
      },
    });
    createdArtifactIds.push(complete.id);

    const result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(true);

    const afterRev = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(afterRev.currentStage).toBe("REVISION");
    expect(afterRev.frozenAt).not.toBeNull();
    expect(afterRev.frozenById).toBe(user.id);

    const afterBuild = await db.build.findUniqueOrThrow({
      where: { id: build.id },
    });
    expect(afterBuild.frozenAt).not.toBeNull();
  });
});

describe("advanceStage — rejection paths", () => {
  test("gate failure: returns { ok: false, reasons } without throwing", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t8.1-gate-fail-${Date.now()}`,
    );
    // No artifacts → REQUIREMENTS gate fails.

    const result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]?.toLowerCase()).toMatch(/no requirements artifact/);

    // Revision stage unchanged.
    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("REQUIREMENTS");
  });

  test("frozen revision: throws", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t8.1-frozen-${Date.now()}`,
    );
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      advanceStage({ revisionId: rev.id }),
    ).rejects.toThrow(/frozen/i);
  });

  test("at REVISION terminal: throws", async () => {
    const rev = await makeRevAtStage(
      "REVISION",
      `t8.1-terminal-${Date.now()}`,
    );

    await expect(
      advanceStage({ revisionId: rev.id }),
    ).rejects.toThrow(/terminal|cannot advance/i);
  });
});

describe("advanceStage — concurrent attempts", () => {
  test("two parallel advances on the same revision: one succeeds, one rejects with stale state OR retryable serialization error", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t8.1-conc-${Date.now()}`,
    );
    await addRequirementsArtifact(rev.id);

    const results = await Promise.allSettled([
      advanceStage({ revisionId: rev.id }),
      advanceStage({ revisionId: rev.id }),
    ]);

    // At least one MUST succeed. With Serializable + the conditional
    // UPDATE, the second either:
    //   (a) loses the row-count check and throws "stale state", OR
    //   (b) the second tx runs after the first has advanced REQUIREMENTS→
    //       SCHEMATIC, so the second's gate context picks up SCHEMATIC and
    //       fails the SCHEMATIC gate (no schematic artifact / commit) →
    //       returns { ok: false }, OR
    //   (c) (very rarely) both succeed because withTxRetry replayed the
    //       failed one and it now advances SCHEMATIC→BOM_SOURCING. The
    //       SCHEMATIC gate blocks that path though, so this is unlikely.
    const okSuccessful = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
    );
    expect(okSuccessful.length).toBeGreaterThanOrEqual(1);

    // Inspect the revision's final state — at most one ADVANCE row from
    // REQUIREMENTS → SCHEMATIC should exist (the second attempt either
    // failed the gate or got "stale state").
    const advanceRows = await db.stageTransition.findMany({
      where: { revisionId: rev.id, direction: "ADVANCE" },
      orderBy: { transitionedAt: "asc" },
    });
    const fromReqs = advanceRows.filter((r) => r.fromStage === "REQUIREMENTS");
    expect(fromReqs).toHaveLength(1);
  });
});

// ─── regressStage tests ────────────────────────────────

describe("regressStage — happy paths", () => {
  test("LAYOUT → BOM_SOURCING clears bomFrozenAt", async () => {
    const rev = await makeRevAtStage(
      "LAYOUT",
      `t8.2-layout-out-${Date.now()}`,
    );
    // Simulate the bomFrozenAt that advanceStage to LAYOUT would have set.
    await db.revision.update({
      where: { id: rev.id },
      data: { bomFrozenAt: new Date() },
    });

    const result = await regressStage({
      revisionId: rev.id,
      reason: "BOM mistake; need to swap a part.",
    });
    expect(result.ok).toBe(true);

    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("BOM_SOURCING");
    expect(after.bomFrozenAt).toBeNull();

    const last = await db.stageTransition.findFirst({
      where: { revisionId: rev.id, direction: "REGRESS" },
      orderBy: { transitionedAt: "desc" },
    });
    expect(last?.fromStage).toBe("LAYOUT");
    expect(last?.toStage).toBe("BOM_SOURCING");
    expect(last?.notes).toBe("BOM mistake; need to swap a part.");
    const snap = last?.gateSnapshot as {
      v: number;
      kind: string;
      reason: string;
      ts: string;
    };
    expect(snap.v).toBe(1);
    expect(snap.kind).toBe("regress");
    expect(snap.reason).toBe("BOM mistake; need to swap a part.");
  });

  test("DRC_GERBER → LAYOUT preserves bomFrozenAt", async () => {
    const rev = await makeRevAtStage(
      "DRC_GERBER",
      `t8.2-into-layout-${Date.now()}`,
    );
    const bomFrozen = new Date("2026-04-01");
    await db.revision.update({
      where: { id: rev.id },
      data: { bomFrozenAt: bomFrozen },
    });

    const result = await regressStage({
      revisionId: rev.id,
      reason: "Layout had a routing miss; redo.",
    });
    expect(result.ok).toBe(true);

    const after = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
    });
    expect(after.currentStage).toBe("LAYOUT");
    expect(after.bomFrozenAt).not.toBeNull();
    expect(after.bomFrozenAt!.toISOString()).toBe(bomFrozen.toISOString());
  });
});

describe("regressStage — rejection paths", () => {
  test("empty reason rejected by Zod", async () => {
    const rev = await makeRevAtStage(
      "SCHEMATIC",
      `t8.2-empty-${Date.now()}`,
    );
    await expect(
      regressStage({ revisionId: rev.id, reason: "" }),
    ).rejects.toThrow();
    await expect(
      regressStage({ revisionId: rev.id, reason: "   " }),
    ).rejects.toThrow();
  });

  test("cannot regress from REQUIREMENTS", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t8.2-req-${Date.now()}`,
    );
    await expect(
      regressStage({ revisionId: rev.id, reason: "go back" }),
    ).rejects.toThrow(/REQUIREMENTS|cannot regress/i);
  });

  test("frozen revision: throws", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t8.2-frozen-${Date.now()}`,
    );
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      regressStage({ revisionId: rev.id, reason: "go back" }),
    ).rejects.toThrow(/frozen/i);
  });
});
