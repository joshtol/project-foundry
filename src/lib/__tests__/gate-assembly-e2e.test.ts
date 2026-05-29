// ASSEMBLY-gate end-to-end exercise (Task 13.5).
//
// Slim integration test that walks the red-to-green narrative described in
// the plan, exercising the actual `advanceStage` server action on a fresh
// revision at ASSEMBLY:
//
//   1. Seed a rev at ASSEMBLY with 1 unfrozen Build and 1 ASSEMBLED Board.
//      Without a POST_ASSEMBLY_CONTINUITY Checklist on the active Build,
//      `advanceStage` returns { ok: false, reasons: [...] } including
//      "No POST_ASSEMBLY_CONTINUITY Checklist on the active Build.".
//
//   2. Create a Build-scoped Checklist with subkind =
//      POST_ASSEMBLY_CONTINUITY and 3 unchecked items via the action layer.
//      `advanceStage` still rejects — reason flips to "has unchecked items".
//
//   3. Tick all items via editChecklistItem. `advanceStage` returns
//      { ok: true }; the revision is now at BRINGUP and a transition row
//      with direction = ADVANCE landed.
//
// Cleanup: every Revision/Build/Board/Checklist created here is tracked
// and removed in afterAll. Pre-existing seeded fixtures are untouched.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import { db } from "@/lib/db";
import { advanceStage } from "@/lib/actions/stages";
import {
  addChecklistItem,
  createChecklist,
  editChecklistItem,
} from "@/lib/actions/checklists";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdRevisionIds: string[] = [];
const createdBuildIds: string[] = [];
const createdBoardIds: string[] = [];
const createdChecklistIds: string[] = [];

beforeAll(() => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));
});

afterAll(async () => {
  if (createdChecklistIds.length > 0) {
    await db.checklist.deleteMany({
      where: { id: { in: createdChecklistIds } },
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

describe("ASSEMBLY gate — end-to-end red-to-green via advanceStage", () => {
  test("blocks → blocks with unchecked items → passes once ticked → rev moves to BRINGUP", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { email: SEED_EMAIL },
    });
    const project = await db.project.findUniqueOrThrow({
      where: { slug: SEED_PROJECT_SLUG },
    });

    // Fresh rev directly at ASSEMBLY (the seed already pinned an v1 rev at
    // BRINGUP; this is a throwaway label so we don't collide).
    const rev = await db.revision.create({
      data: {
        projectId: project.id,
        label: `t13.5-e2e-${Date.now()}`,
        currentStage: "ASSEMBLY",
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

    const build = await db.build.create({
      data: {
        revisionId: rev.id,
        label: `BUILD-E2E-${Date.now()}`,
        boardCount: 1,
        createdById: user.id,
      },
    });
    createdBuildIds.push(build.id);

    const board = await db.board.create({
      data: {
        buildId: build.id,
        serial: "B01",
        status: "ASSEMBLED",
      },
    });
    createdBoardIds.push(board.id);

    // Step 1: no POST_ASSEMBLY_CONTINUITY Checklist → advanceStage blocked.
    let result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain(
        "No POST_ASSEMBLY_CONTINUITY Checklist on the active Build.",
      );
    }
    // Confirm rev did NOT advance — still at ASSEMBLY.
    const after1 = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
      select: { currentStage: true },
    });
    expect(after1.currentStage).toBe("ASSEMBLY");

    // Step 2: create the checklist + 3 unchecked items via the action layer
    // (exercises the real freeze guards + ordinal defaulting from Task 13.1).
    const checklist = await createChecklist({
      ownerKind: "build",
      buildId: build.id,
      subkind: "POST_ASSEMBLY_CONTINUITY",
      stage: "ASSEMBLY",
      // Deliberate title divergence — the gate matches on subkind, not text.
      title: "Final wraparound continuity sweep",
    });
    createdChecklistIds.push(checklist.id);

    const items = await Promise.all([
      addChecklistItem({ checklistId: checklist.id, label: "5V rail" }),
      addChecklistItem({ checklistId: checklist.id, label: "3V3 rail" }),
      addChecklistItem({ checklistId: checklist.id, label: "GND continuity" }),
    ]);

    result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain(
        "POST_ASSEMBLY_CONTINUITY Checklist has unchecked items.",
      );
    }
    const after2 = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
      select: { currentStage: true },
    });
    expect(after2.currentStage).toBe("ASSEMBLY");

    // Step 3: tick every item, then advanceStage succeeds.
    for (const i of items) {
      await editChecklistItem({ id: i.id, checked: true });
    }
    result = await advanceStage({ revisionId: rev.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.fromStage).toBe("ASSEMBLY");
      expect(result.transition.toStage).toBe("BRINGUP");
      expect(result.transition.direction).toBe("ADVANCE");
    }
    const after3 = await db.revision.findUniqueOrThrow({
      where: { id: rev.id },
      select: { currentStage: true },
    });
    expect(after3.currentStage).toBe("BRINGUP");
  });
});
