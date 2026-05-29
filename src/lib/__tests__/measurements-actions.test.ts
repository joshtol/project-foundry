// Tests for Measurement server actions (Task 14.1).
//
// Exercises the real Neon DB; mocks `next/cache` and `@/auth` per the
// repository's vitest mocking pattern.
//
// createMeasurement covers:
//   - Single add inherits default result = PEND when omitted.
//   - measuredById stamped from the current user.
//   - Frozen revision rejected.
//   - Frozen build rejected.
//
// addMeasurementsBulk covers:
//   - 5-row batch insert returns { count: 5 } and lands all rows in one tx.
//   - Atomic on Zod failure: if any row's `actualValue` is missing, the
//     entire batch rejects and nothing persists.
//
// editMeasurement covers:
//   - result update PEND → PASS reflected on the row.
//
// Cleanup: every Revision/Build/Board created here is removed in afterAll
// (Measurement rows cascade via Board → Build → Revision delete).
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
import {
  addMeasurementsBulk,
  createMeasurement,
  editMeasurement,
} from "@/lib/actions/measurements";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdRevisionIds: string[] = [];
const createdBuildIds: string[] = [];
const createdBoardIds: string[] = [];

beforeAll(() => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));
});

afterAll(async () => {
  // Measurement rows cascade via Board onDelete: Cascade.
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

async function makeFixture(
  stage: Stage,
  label: string,
): Promise<{ rev: { id: string }; build: { id: string }; board: { id: string } }> {
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

  const build = await db.build.create({
    data: {
      revisionId: rev.id,
      label: `BUILD-MEAS-${Date.now()}`,
      boardCount: 1,
      createdById: user.id,
    },
  });
  createdBuildIds.push(build.id);

  const board = await db.board.create({
    data: { buildId: build.id, serial: "B01", status: "POWERED" },
  });
  createdBoardIds.push(board.id);

  return { rev, build, board };
}

// ─── createMeasurement ─────────────────────────────────

describe("createMeasurement", () => {
  test("single add: default result PEND, measuredById stamped", async () => {
    const { board } = await makeFixture("BRINGUP", `t14.1-single-${Date.now()}`);
    const user = await seedUser();

    const m = await createMeasurement({
      boardId: board.id,
      stage: "BRINGUP",
      step: "5V0 rail",
      expectedValue: "5.00",
      actualValue: "5.02",
      unit: "V",
      // result omitted → default PEND
    });

    expect(m.boardId).toBe(board.id);
    expect(m.stage).toBe("BRINGUP");
    expect(m.step).toBe("5V0 rail");
    expect(m.expectedValue).toBe("5.00");
    expect(m.actualValue).toBe("5.02");
    expect(m.unit).toBe("V");
    expect(m.result).toBe("PEND");
    expect(m.measuredById).toBe(user.id);
  });

  test("explicit result PASS honored", async () => {
    const { board } = await makeFixture(
      "BRINGUP",
      `t14.1-pass-${Date.now()}`,
    );
    const m = await createMeasurement({
      boardId: board.id,
      stage: "BRINGUP",
      step: "3V3 rail",
      actualValue: "3.31",
      unit: "V",
      result: "PASS",
    });
    expect(m.result).toBe("PASS");
  });

  test("frozen revision: rejected", async () => {
    const user = await seedUser();
    const { rev, board } = await makeFixture(
      "BRINGUP",
      `t14.1-frozen-rev-${Date.now()}`,
    );
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      createMeasurement({
        boardId: board.id,
        stage: "BRINGUP",
        step: "should fail",
        actualValue: "x",
      }),
    ).rejects.toThrow(/frozen/i);
  });

  test("frozen build: rejected", async () => {
    const { build, board } = await makeFixture(
      "BRINGUP",
      `t14.1-frozen-build-${Date.now()}`,
    );
    await db.build.update({
      where: { id: build.id },
      data: { frozenAt: new Date() },
    });

    await expect(
      createMeasurement({
        boardId: board.id,
        stage: "BRINGUP",
        step: "should fail",
        actualValue: "x",
      }),
    ).rejects.toThrow(/build is frozen/i);
  });
});

// ─── addMeasurementsBulk ───────────────────────────────

describe("addMeasurementsBulk", () => {
  test("5-row batch lands atomically and returns { count: 5 }", async () => {
    const { board } = await makeFixture(
      "BRINGUP",
      `t14.1-bulk-ok-${Date.now()}`,
    );
    const before = await db.measurement.count({
      where: { boardId: board.id },
    });

    const result = await addMeasurementsBulk({
      boardId: board.id,
      rows: [
        { stage: "BRINGUP", step: "5V0", actualValue: "5.02", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "3V3", actualValue: "3.31", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "1V8", actualValue: "1.80", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "I_quiescent", actualValue: "12.5", unit: "mA", result: "OBSERVED" },
        { stage: "BRINGUP", step: "VBAT", actualValue: "3.74", unit: "V" }, // PEND default
      ],
    });
    expect(result.count).toBe(5);

    const after = await db.measurement.count({
      where: { boardId: board.id },
    });
    expect(after - before).toBe(5);

    const rows = await db.measurement.findMany({
      where: { boardId: board.id },
      orderBy: { step: "asc" },
    });
    expect(rows.find((r) => r.step === "VBAT")?.result).toBe("PEND");
    expect(rows.find((r) => r.step === "I_quiescent")?.result).toBe("OBSERVED");
  });

  test("bulk with missing actualValue on one row rejects whole batch (atomic)", async () => {
    const { board } = await makeFixture(
      "BRINGUP",
      `t14.1-bulk-atomic-${Date.now()}`,
    );
    const before = await db.measurement.count({
      where: { boardId: board.id },
    });

    await expect(
      addMeasurementsBulk({
        boardId: board.id,
        rows: [
          { stage: "BRINGUP", step: "ok", actualValue: "5.0" },
          // missing actualValue — Zod rejects the whole envelope
          { stage: "BRINGUP", step: "broken" } as never,
        ],
      }),
    ).rejects.toThrow();

    const after = await db.measurement.count({
      where: { boardId: board.id },
    });
    expect(after).toBe(before);
  });

  test("frozen build: rejected (bulk)", async () => {
    const { build, board } = await makeFixture(
      "BRINGUP",
      `t14.1-bulk-frozen-${Date.now()}`,
    );
    await db.build.update({
      where: { id: build.id },
      data: { frozenAt: new Date() },
    });

    await expect(
      addMeasurementsBulk({
        boardId: board.id,
        rows: [{ stage: "BRINGUP", step: "x", actualValue: "1.0" }],
      }),
    ).rejects.toThrow(/build is frozen/i);
  });
});

// ─── editMeasurement ───────────────────────────────────

describe("editMeasurement", () => {
  test("update PEND → PASS reflected on the row", async () => {
    const { board } = await makeFixture(
      "BRINGUP",
      `t14.1-edit-${Date.now()}`,
    );
    const m = await createMeasurement({
      boardId: board.id,
      stage: "BRINGUP",
      step: "5V0",
      actualValue: "5.02",
      unit: "V",
    });
    expect(m.result).toBe("PEND");

    const updated = await editMeasurement({ id: m.id, result: "PASS" });
    expect(updated.result).toBe("PASS");
    expect(updated.actualValue).toBe("5.02");
  });
});
