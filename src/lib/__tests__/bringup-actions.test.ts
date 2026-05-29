// Tests for markBringupComplete server action (Task 9.4).
//
// Exercises the real Neon DB; mocks `next/cache` and `@/auth` per the same
// pattern as the other action tests.
//
// markBringupComplete covers:
//   - Boards with mixed statuses (some not BROUGHT_UP) → throws with
//     "Blocked by boards…" prefix + comma-separated serial sample (up to 5).
//   - >5 blocking boards → message includes "…and N more".
//   - All boards BROUGHT_UP → inserts a BRINGUP_COMPLETE artifact on the
//     build, kind=NOTE, with the canonical title + body.
//   - BRINGUP_COMPLETE already exists → throws "already".
//   - Frozen build → throws "Build is frozen."
//   - Frozen revision → throws "Revision is frozen."
//   - All boards QUARANTINED (mix with BROUGHT_UP) → passes.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuth = vi.fn<() => Promise<unknown>>();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

import type { BoardStatus, Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { markBringupComplete } from "@/lib/actions/bringup";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdArtifactIds: string[] = [];
const createdBuildIds: string[] = [];
const createdBoardIds: string[] = [];
const createdRevisionIds: string[] = [];

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

async function makeRev(stage: Stage, label: string) {
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
  return rev;
}

async function makeBuildWithBoards(
  revisionId: string,
  label: string,
  serials: string[],
  statuses: BoardStatus[],
) {
  const user = await seedUser();
  const build = await db.build.create({
    data: {
      revisionId,
      label,
      boardCount: serials.length,
      createdById: user.id,
    },
  });
  createdBuildIds.push(build.id);

  for (let i = 0; i < serials.length; i++) {
    const board = await db.board.create({
      data: {
        buildId: build.id,
        serial: serials[i]!,
        status: statuses[i]!,
      },
    });
    createdBoardIds.push(board.id);
  }
  return build;
}

describe("markBringupComplete — rejection: pending boards", () => {
  test("3 pending boards: throws with comma-separated sample, no truncation", async () => {
    const rev = await makeRev("BRINGUP", `t9.4-pend3-${Date.now()}`);
    await makeBuildWithBoards(
      rev.id,
      `BUILD-PEND3-${Date.now()}`,
      ["P01", "P02", "P03"],
      ["ASSEMBLED", "POWERED", "ASSEMBLED"],
    );

    const build = await db.build.findFirstOrThrow({
      where: { revisionId: rev.id },
    });

    try {
      await markBringupComplete(build.id);
      throw new Error("expected rejection");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Blocked by boards not BROUGHT_UP or QUARANTINED:/);
      expect(msg).toContain("P01");
      expect(msg).toContain("P02");
      expect(msg).toContain("P03");
      expect(msg).not.toMatch(/and \d+ more/);
    }
  });

  test(">5 pending boards: message truncates with '…and N more'", async () => {
    const rev = await makeRev("BRINGUP", `t9.4-pendmany-${Date.now()}`);
    const serials = ["S01", "S02", "S03", "S04", "S05", "S06", "S07"];
    await makeBuildWithBoards(
      rev.id,
      `BUILD-MANY-${Date.now()}`,
      serials,
      Array(7).fill("ASSEMBLED" as BoardStatus),
    );

    const build = await db.build.findFirstOrThrow({
      where: { revisionId: rev.id },
    });

    try {
      await markBringupComplete(build.id);
      throw new Error("expected rejection");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // First 5 serials present.
      expect(msg).toContain("S01");
      expect(msg).toContain("S02");
      expect(msg).toContain("S03");
      expect(msg).toContain("S04");
      expect(msg).toContain("S05");
      // 6th and 7th NOT directly named — they're in the "more" bucket.
      expect(msg).not.toContain("S06");
      expect(msg).not.toContain("S07");
      // Truncation marker.
      expect(msg).toMatch(/…and 2 more/);
    }
  });
});

describe("markBringupComplete — happy path", () => {
  test("all BROUGHT_UP → inserts BRINGUP_COMPLETE artifact with canonical body", async () => {
    const user = await seedUser();
    const rev = await makeRev("BRINGUP", `t9.4-happy-${Date.now()}`);
    const build = await makeBuildWithBoards(
      rev.id,
      `BUILD-HAPPY-${Date.now()}`,
      ["B01", "B02"],
      ["BROUGHT_UP", "BROUGHT_UP"],
    );

    const art = await markBringupComplete(build.id);
    createdArtifactIds.push(art.id);

    expect(art.buildId).toBe(build.id);
    expect(art.revisionId).toBeNull();
    expect(art.kind).toBe("NOTE");
    expect(art.subkind).toBe("BRINGUP_COMPLETE");
    expect(art.stage).toBe("BRINGUP");
    expect(art.title).toBe("Bring-up complete");
    expect(art.noteBody).toMatch(/User-confirmed bring-up complete/);
    expect(art.createdBy).toBe(user.id);
  });

  test("mix of BROUGHT_UP + QUARANTINED → passes", async () => {
    const rev = await makeRev("BRINGUP", `t9.4-mixok-${Date.now()}`);
    const build = await makeBuildWithBoards(
      rev.id,
      `BUILD-MIXOK-${Date.now()}`,
      ["M01", "M02", "M03"],
      ["BROUGHT_UP", "QUARANTINED", "BROUGHT_UP"],
    );

    const art = await markBringupComplete(build.id);
    createdArtifactIds.push(art.id);

    expect(art.subkind).toBe("BRINGUP_COMPLETE");
  });
});

describe("markBringupComplete — duplicate guard", () => {
  test("BRINGUP_COMPLETE already exists → throws 'already'", async () => {
    const rev = await makeRev("BRINGUP", `t9.4-dup-${Date.now()}`);
    const build = await makeBuildWithBoards(
      rev.id,
      `BUILD-DUP-${Date.now()}`,
      ["D01"],
      ["BROUGHT_UP"],
    );

    const first = await markBringupComplete(build.id);
    createdArtifactIds.push(first.id);

    await expect(markBringupComplete(build.id)).rejects.toThrow(/already/i);
  });
});

describe("markBringupComplete — freeze guards", () => {
  test("frozen build → throws 'Build is frozen.'", async () => {
    const rev = await makeRev("BRINGUP", `t9.4-frbuild-${Date.now()}`);
    const build = await makeBuildWithBoards(
      rev.id,
      `BUILD-FRBLD-${Date.now()}`,
      ["F01"],
      ["BROUGHT_UP"],
    );
    await db.build.update({
      where: { id: build.id },
      data: { frozenAt: new Date() },
    });

    await expect(markBringupComplete(build.id)).rejects.toThrow(
      /Build is frozen/i,
    );
  });

  test("frozen revision → throws 'Revision is frozen.'", async () => {
    const user = await seedUser();
    const rev = await makeRev("BRINGUP", `t9.4-frrev-${Date.now()}`);
    const build = await makeBuildWithBoards(
      rev.id,
      `BUILD-FRREV-${Date.now()}`,
      ["FR01"],
      ["BROUGHT_UP"],
    );
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(markBringupComplete(build.id)).rejects.toThrow(
      /Revision is frozen/i,
    );
  });
});
