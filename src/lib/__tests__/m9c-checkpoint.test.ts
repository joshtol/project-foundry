// M9c checkpoint (Task 14.3).
//
// Demoable Measurements CRUD on the seeded "esp32-sensor-breakout" v1
// BRINGUP fixture (BUILD-001 / B01). The checkpoint exercises:
//   - 5 single-add measurements with a mix of PASS, FAIL, OBSERVED, PEND
//     results across two stages (ASSEMBLY + BRINGUP).
//   - 10 more measurements via the bulk paste-tabbed action — a single
//     Serializable tx.
//   - A read-back grouped by (stage, step) confirming the log groups
//     correctly: total counts per (stage, step) bucket match what we
//     inserted.
//
// Cleanup: every measurement created by this test is removed in afterAll
// so the seeded baseline (no measurements yet) is restored.
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
  addMeasurementsBulk,
  createMeasurement,
} from "@/lib/actions/measurements";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

let seededBoardId = "";
const createdMeasurementIds: string[] = [];

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
  const board = await db.board.findFirstOrThrow({
    where: {
      buildId: build.id,
      serial: { equals: "B01", mode: "insensitive" },
    },
  });
  seededBoardId = board.id;
});

afterAll(async () => {
  if (createdMeasurementIds.length > 0) {
    await db.measurement.deleteMany({
      where: { id: { in: createdMeasurementIds } },
    });
  }
});

describe("M9c checkpoint — Measurements on seeded B01", () => {
  test("5 single-add measurements (mixed results, varied stages) + 10 bulk measurements; grouping correct", async () => {
    // Single-add wave: 5 rows split between BRINGUP and ASSEMBLY stages
    // covering all four result enums.
    const singles = [
      { stage: "BRINGUP" as const, step: "5V0 rail", actualValue: "5.02", unit: "V", result: "PASS" as const },
      { stage: "BRINGUP" as const, step: "3V3 rail", actualValue: "3.31", unit: "V", result: "PASS" as const },
      { stage: "BRINGUP" as const, step: "I_quiescent", actualValue: "12.5", unit: "mA", result: "OBSERVED" as const },
      { stage: "ASSEMBLY" as const, step: "GND continuity", actualValue: "OL", result: "FAIL" as const },
      { stage: "ASSEMBLY" as const, step: "Visual inspect", actualValue: "clean", result: "PEND" as const },
    ];
    for (const s of singles) {
      const m = await createMeasurement({ boardId: seededBoardId, ...s });
      createdMeasurementIds.push(m.id);
    }

    // Bulk wave: 10 BRINGUP rows on the bring-up power tape (mixed stages
    // here too to exercise grouping).
    const bulkResult = await addMeasurementsBulk({
      boardId: seededBoardId,
      rows: [
        { stage: "BRINGUP", step: "1V8 rail", actualValue: "1.80", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "VBAT", actualValue: "3.74", unit: "V", result: "OBSERVED" },
        { stage: "BRINGUP", step: "VBUS", actualValue: "5.01", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "5V0 rail", actualValue: "5.01", unit: "V", result: "PASS" }, // 2nd reading on same step
        { stage: "BRINGUP", step: "RST high", actualValue: "3.30", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "BOOT0 low", actualValue: "0.00", unit: "V", result: "PASS" },
        { stage: "BRINGUP", step: "OSC freq", actualValue: "8.000", unit: "MHz", result: "PASS" },
        { stage: "BRINGUP", step: "JTAG ID", actualValue: "0xABCD1234", result: "OBSERVED" },
        { stage: "BRINGUP", step: "UART loopback", actualValue: "ok", result: "PASS" },
        { stage: "BRINGUP", step: "I2C scan", actualValue: "0x40,0x68", result: "OBSERVED" },
      ],
    });
    expect(bulkResult.count).toBe(10);

    // Track the bulk-inserted ids for cleanup.
    const bulkRows = await db.measurement.findMany({
      where: { boardId: seededBoardId, id: { notIn: createdMeasurementIds } },
      select: { id: true },
    });
    for (const r of bulkRows) createdMeasurementIds.push(r.id);

    // Grouping read-back: pull every measurement we just inserted and
    // assert the (stage, step) bucket counts.
    const all = await db.measurement.findMany({
      where: { id: { in: createdMeasurementIds } },
      select: { stage: true, step: true, result: true },
    });
    expect(all.length).toBe(15);

    // Stage buckets
    const byStage = new Map<string, number>();
    for (const m of all) {
      byStage.set(m.stage, (byStage.get(m.stage) ?? 0) + 1);
    }
    expect(byStage.get("BRINGUP")).toBe(13);
    expect(byStage.get("ASSEMBLY")).toBe(2);

    // (stage, step) bucket for "5V0 rail" should have 2 entries (one
    // single-add, one bulk) — exercises the "same step grouped" rule.
    const fiveVee = all.filter(
      (m) => m.stage === "BRINGUP" && m.step === "5V0 rail",
    );
    expect(fiveVee.length).toBe(2);

    // Result breakdown sanity check.
    const byResult = new Map<string, number>();
    for (const m of all) {
      byResult.set(m.result, (byResult.get(m.result) ?? 0) + 1);
    }
    expect(byResult.get("PASS")).toBeGreaterThanOrEqual(1);
    expect(byResult.get("FAIL")).toBe(1);
    expect(byResult.get("OBSERVED")).toBeGreaterThanOrEqual(1);
    expect(byResult.get("PEND")).toBeGreaterThanOrEqual(1);
  });
});
