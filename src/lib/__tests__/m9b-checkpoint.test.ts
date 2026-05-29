// M9b checkpoint (Task 13.6).
//
// Demoable Checklists CRUD on the seeded "esp32-sensor-breakout" v1 BRINGUP
// fixture (BUILD-001 with boards B01-B05). The checkpoint exercises both
// owner-XOR paths plus add/tick/reorder against the live action layer.
//
// Note: the seeded rev is at BRINGUP, but BRINGUP and ASSEMBLY are both
// post-ORDERING stages — Checklist.stage on a Build at BRINGUP can be set
// to BRINGUP since the design doesn't restrict subkind→stage at the schema
// level (the ASSEMBLY gate matches subkind only, not stage). We use the
// rev's current stage to honor the "pinned to current rev stage" UI rule.
//
// Cleanup restores the seeded baseline: every checklist/item created here
// is removed in afterAll. The seeded boards and build are left intact.
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
  addChecklistItem,
  createChecklist,
  editChecklistItem,
  reorderChecklistItems,
} from "@/lib/actions/checklists";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

let seededBuildId = "";
let seededBoardId = "";
let seededRevStage: "ASSEMBLY" | "BRINGUP" | string = "";
const createdChecklistIds: string[] = [];

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
  seededRevStage = rev.currentStage;
  const build = await db.build.findFirstOrThrow({
    where: { revisionId: rev.id },
  });
  seededBuildId = build.id;
  const board = await db.board.findFirstOrThrow({
    where: {
      buildId: build.id,
      serial: { equals: "B01", mode: "insensitive" },
    },
  });
  seededBoardId = board.id;
});

afterAll(async () => {
  if (createdChecklistIds.length > 0) {
    await db.checklist.deleteMany({
      where: { id: { in: createdChecklistIds } },
    });
  }
});

describe("M9b checkpoint — Checklists CRUD on seeded BUILD-001 + B01", () => {
  test("Build XOR: EQUIPMENT_PREFLIGHT checklist on BUILD-001 + add/tick/reorder", async () => {
    const ck = await createChecklist({
      ownerKind: "build",
      buildId: seededBuildId,
      subkind: "EQUIPMENT_PREFLIGHT",
      stage: seededRevStage,
      title: "M9b — Equipment preflight",
    });
    createdChecklistIds.push(ck.id);

    expect(ck.buildId).toBe(seededBuildId);
    expect(ck.boardId).toBeNull();
    expect(ck.subkind).toBe("EQUIPMENT_PREFLIGHT");

    const a = await addChecklistItem({
      checklistId: ck.id,
      label: "Bench supply set to 5V0",
    });
    const b = await addChecklistItem({
      checklistId: ck.id,
      label: "Current limit set to 200mA",
    });
    const c = await addChecklistItem({
      checklistId: ck.id,
      label: "Probe ground clipped",
    });
    expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([0, 1, 2]);

    // Tick one item — exercise completion stamping.
    const ticked = await editChecklistItem({ id: a.id, checked: true });
    expect(ticked.checked).toBe(true);
    expect(ticked.completedAt).not.toBeNull();
    expect(ticked.completedById).not.toBeNull();

    // Reorder: move "Probe ground clipped" to the top.
    const reordered = await reorderChecklistItems({
      checklistId: ck.id,
      orderedIds: [c.id, a.id, b.id],
    });
    const byId = new Map(reordered.map((r) => [r.id, r.ordinal]));
    expect(byId.get(c.id)).toBe(0);
    expect(byId.get(a.id)).toBe(1);
    expect(byId.get(b.id)).toBe(2);
  });

  test("Board XOR: SCREENING_STEP_0 checklist on B01 + add/tick/reorder", async () => {
    const ck = await createChecklist({
      ownerKind: "board",
      boardId: seededBoardId,
      subkind: "SCREENING_STEP_0",
      stage: seededRevStage,
      title: "M9b — Board screening",
    });
    createdChecklistIds.push(ck.id);

    expect(ck.boardId).toBe(seededBoardId);
    expect(ck.buildId).toBeNull();
    expect(ck.subkind).toBe("SCREENING_STEP_0");

    const a = await addChecklistItem({
      checklistId: ck.id,
      label: "Visual inspection — no shorts",
    });
    const b = await addChecklistItem({
      checklistId: ck.id,
      label: "Silkscreen hash legible",
    });
    const c = await addChecklistItem({
      checklistId: ck.id,
      label: "Fiducials present",
    });
    expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([0, 1, 2]);

    await editChecklistItem({ id: b.id, checked: true });

    const reordered = await reorderChecklistItems({
      checklistId: ck.id,
      orderedIds: [c.id, b.id, a.id],
    });
    const byId = new Map(reordered.map((r) => [r.id, r.ordinal]));
    expect(byId.get(c.id)).toBe(0);
    expect(byId.get(b.id)).toBe(1);
    expect(byId.get(a.id)).toBe(2);
  });
});
