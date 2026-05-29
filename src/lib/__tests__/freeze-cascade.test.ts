// Build freeze cascade test (Task 8.4).
//
// Recreates the demoable scenario: a fresh BUILD with 5 boards initially
// ASSEMBLED (mirroring the seeded BUILD-001) → flip them all to BROUGHT_UP
// via direct SQL (Board CRUD UI ships in Phase 12) → attach BRINGUP_LOG +
// BRINGUP_COMPLETE artifacts → advance BRINGUP → REVISION → verify BOTH
// Revision.frozenAt AND Build.frozenAt are set in the same transaction.
//
// Mirrors design §5.3 step 7 + design §5.4 cascade rule. Phase 1
// invariant guarantees at most one unfrozen Build per Revision, so the
// "active build" is unambiguous.

import { afterAll, beforeAll, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import { db } from "@/lib/db";
import { advanceStage } from "@/lib/actions/stages";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdRevisionIds: string[] = [];
const createdBuildIds: string[] = [];
const createdBoardIds: string[] = [];
const createdArtifactIds: string[] = [];

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

test("BRINGUP → REVISION cascades freeze to the active Build", async () => {
  const user = await db.user.findUniqueOrThrow({
    where: { email: SEED_EMAIL },
  });
  const project = await db.project.findUniqueOrThrow({
    where: { slug: SEED_PROJECT_SLUG },
  });

  // Throwaway rev at BRINGUP.
  const rev = await db.revision.create({
    data: {
      projectId: project.id,
      label: `t8.4-cascade-${Date.now()}`,
      currentStage: "BRINGUP",
    },
  });
  createdRevisionIds.push(rev.id);
  await db.stageTransition.create({
    data: {
      revisionId: rev.id,
      fromStage: null,
      toStage: "REQUIREMENTS",
      direction: "INIT",
      gateSnapshot: { v: 1, kind: "init", ts: new Date().toISOString() },
      transitionedBy: user.id,
    },
  });

  // Replicate seeded BUILD-001 shape: 5 boards.
  const build = await db.build.create({
    data: {
      revisionId: rev.id,
      label: `BUILD-CASCADE-${Date.now()}`,
      boardCount: 5,
      createdById: user.id,
    },
  });
  createdBuildIds.push(build.id);

  // Boards B01-B04 BROUGHT_UP, B05 QUARANTINED (mirrors the design §1
  // demoable end-state).
  for (let i = 1; i <= 5; i++) {
    const status = i === 5 ? "QUARANTINED" : "BROUGHT_UP";
    const board = await db.board.create({
      data: {
        buildId: build.id,
        serial: `B0${i}`,
        status,
      },
    });
    createdBoardIds.push(board.id);
  }

  // Both BRINGUP artifacts present so the gate passes.
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

  // Sanity-check: neither frozen yet.
  expect((await db.revision.findUniqueOrThrow({ where: { id: rev.id } })).frozenAt).toBeNull();
  expect((await db.build.findUniqueOrThrow({ where: { id: build.id } })).frozenAt).toBeNull();

  const result = await advanceStage({ revisionId: rev.id });
  expect(result.ok).toBe(true);

  const afterRev = await db.revision.findUniqueOrThrow({
    where: { id: rev.id },
  });
  const afterBuild = await db.build.findUniqueOrThrow({
    where: { id: build.id },
  });
  expect(afterRev.currentStage).toBe("REVISION");
  expect(afterRev.frozenAt).not.toBeNull();
  expect(afterRev.frozenById).toBe(user.id);
  expect(afterBuild.frozenAt).not.toBeNull();
  // Cascade happened in the same tx — timestamps should be within seconds.
  const skewMs = Math.abs(
    afterBuild.frozenAt!.getTime() - afterRev.frozenAt!.getTime(),
  );
  expect(skewMs).toBeLessThan(5_000);
});
