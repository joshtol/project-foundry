// loadGateContext + seeded BRINGUP gate integration (Task 7.3).
//
// Exercises loadGateContext against the live seeded "esp32-sensor-breakout"
// v1 revision and verifies:
//
//  1. The loader returns the expected shape (Pick'd revision, BomLines with
//     parts, current-stage-filtered artifacts, the unique unfrozen Build
//     with boards + artifacts + checklists).
//  2. Feeding that ctx into `STAGES.BRINGUP.exitGate(ctx)` yields the
//     expected demo state: gate FAILS with exactly the canonical
//     "N board(s) not yet BROUGHT_UP or QUARANTINED." reason — because the
//     seed leaves boards at ASSEMBLED. Phase 8 lets the user transition
//     boards; until then this is the demoable "blocked" state for the
//     read-side stage tracker.
//
// No mocks needed — this hits the real DB via the shared `db` client.
import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { loadGateContext } from "@/lib/load-gate-context";
import { STAGES } from "@/lib/stages";

const SEED_PROJECT_SLUG = "esp32-sensor-breakout";
const SEED_REV_LABEL = "v1";

describe("loadGateContext on seeded v1 BRINGUP revision", () => {
  test("returns the expected ctx shape", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { slug: SEED_PROJECT_SLUG },
      select: { id: true },
    });
    const rev = await db.revision.findFirstOrThrow({
      where: {
        projectId: project.id,
        label: { equals: SEED_REV_LABEL, mode: "insensitive" },
      },
      select: { id: true },
    });
    const ctx = await loadGateContext(db, rev.id);

    expect(ctx.revision.currentStage).toBe("BRINGUP");
    expect(typeof ctx.revision.schematicCommit).toBe("string");
    expect(typeof ctx.revision.layoutCommit).toBe("string");

    // Seed has 3 BomLines, each with an ACTIVE part with a datasheet URL.
    expect(ctx.bomLines.length).toBeGreaterThanOrEqual(3);
    for (const line of ctx.bomLines) {
      expect(line.part).toBeDefined();
      expect(line.part.lifecycle).toBe("ACTIVE");
    }

    // Revision-scoped artifacts at BRINGUP — seed doesn't add any
    // revision-scoped artifacts at BRINGUP; the BRINGUP_* ones live on the
    // Build.
    expect(Array.isArray(ctx.artifacts)).toBe(true);

    // Active Build: BUILD-001 with 5 boards, 4 artifacts on it.
    expect(ctx.activeBuild).not.toBeNull();
    const build = ctx.activeBuild!;
    expect(build.frozenAt).toBeNull();
    expect(build.boards.length).toBe(5);
    expect(build.artifacts.some((a) => a.subkind === "BRINGUP_LOG")).toBe(true);
    expect(
      build.artifacts.some((a) => a.subkind === "BRINGUP_COMPLETE"),
    ).toBe(true);
  });

  test("BRINGUP gate evaluates on seeded ctx and fails with the canonical 'not yet BROUGHT_UP or QUARANTINED' reason", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { slug: SEED_PROJECT_SLUG },
      select: { id: true },
    });
    const rev = await db.revision.findFirstOrThrow({
      where: {
        projectId: project.id,
        label: { equals: SEED_REV_LABEL, mode: "insensitive" },
      },
      select: { id: true },
    });
    const ctx = await loadGateContext(db, rev.id);

    const result = await STAGES.BRINGUP.exitGate!(ctx);

    // Seed leaves boards at ASSEMBLED — gate is expected to fail. Once
    // Phase 8 ships and the user advances boards through the UI, this
    // assertion will need to be relaxed (or the seed updated).
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reasons).toContain(
        "5 board(s) not yet BROUGHT_UP or QUARANTINED.",
      );
    }
  });
});
