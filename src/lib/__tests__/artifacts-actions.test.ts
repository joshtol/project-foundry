// Tests for Artifact server actions (Task 9.2).
//
// Exercises the real Neon DB; mocks `next/cache` and `@/auth` per the same
// pattern as the other action tests.
//
// createArtifact covers:
//   - NOTE on revision: succeeds, sanitizes <script> out of noteBody,
//     stamps createdBy.
//   - LINK on build: succeeds, stores linkUrl.
//   - Mismatched owner+subkind rejected (PCB_ORDER on revision).
//   - Subkind not allowed at the current stage rejected.
//   - Frozen revision rejected.
//   - Frozen build rejected.
//
// editArtifact covers:
//   - Edit title succeeds on unfrozen.
//   - Edit on frozen rev rejected.
//
// deleteArtifact covers:
//   - Delete succeeds on unfrozen.
//   - Delete on frozen rev rejected.
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
  createArtifact,
  deleteArtifact,
  editArtifact,
} from "@/lib/actions/artifacts";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdArtifactIds: string[] = [];
const createdBuildIds: string[] = [];
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

async function makeBuild(revisionId: string, label: string) {
  const user = await seedUser();
  const build = await db.build.create({
    data: {
      revisionId,
      label,
      boardCount: 1,
      createdById: user.id,
    },
  });
  createdBuildIds.push(build.id);
  return build;
}

// ─── createArtifact ────────────────────────────────────

describe("createArtifact — happy paths", () => {
  test("NOTE on revision at REQUIREMENTS: succeeds and sanitizes script tag", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-noterev-${Date.now()}`,
    );
    const user = await seedUser();

    const dirty =
      "Real markdown text. <script>alert('x')</script>More text after.";
    const art = await createArtifact({
      owner: { kind: "revision", id: rev.id },
      stage: "REQUIREMENTS",
      subkind: "REQUIREMENTS_DOC",
      kind: "NOTE",
      title: "Requirements",
      noteBody: dirty,
    });
    createdArtifactIds.push(art.id);

    expect(art.revisionId).toBe(rev.id);
    expect(art.buildId).toBeNull();
    expect(art.kind).toBe("NOTE");
    expect(art.subkind).toBe("REQUIREMENTS_DOC");
    expect(art.title).toBe("Requirements");
    expect(art.linkUrl).toBeNull();
    expect(art.createdBy).toBe(user.id);

    // The <script>...</script> block (open tag + contents + close tag) is
    // stripped by `nonTextTags: ["script", ...]`.
    expect(art.noteBody).not.toContain("<script>");
    expect(art.noteBody).not.toContain("alert");
    expect(art.noteBody).toContain("Real markdown text.");
    expect(art.noteBody).toContain("More text after.");
  });

  test("LINK on build at ORDERING: succeeds and stores linkUrl", async () => {
    const rev = await makeRevAtStage(
      "ORDERING",
      `t9.2-linkbuild-rev-${Date.now()}`,
    );
    const build = await makeBuild(rev.id, `BUILD-LINK-${Date.now()}`);

    const art = await createArtifact({
      owner: { kind: "build", id: build.id },
      stage: "ORDERING",
      subkind: "PCB_ORDER",
      kind: "LINK",
      title: "JLC order",
      linkUrl: "https://example.com/order/123",
    });
    createdArtifactIds.push(art.id);

    expect(art.buildId).toBe(build.id);
    expect(art.revisionId).toBeNull();
    expect(art.kind).toBe("LINK");
    expect(art.linkUrl).toBe("https://example.com/order/123");
    expect(art.noteBody).toBeNull();
  });
});

describe("createArtifact — rejection paths", () => {
  test("PCB_ORDER on revision (owner mismatch): rejected before DB call", async () => {
    const rev = await makeRevAtStage(
      "ORDERING",
      `t9.2-mismatch-${Date.now()}`,
    );

    await expect(
      createArtifact({
        owner: { kind: "revision", id: rev.id },
        stage: "ORDERING",
        subkind: "PCB_ORDER",
        kind: "LINK",
        title: "wrong owner",
        linkUrl: "https://example.com",
      }),
    ).rejects.toThrow(/not valid for revision/i);
  });

  test("REQUIREMENTS_DOC at LAYOUT stage (subkind not allowed): rejected", async () => {
    const rev = await makeRevAtStage(
      "LAYOUT",
      `t9.2-stagewrong-${Date.now()}`,
    );

    await expect(
      createArtifact({
        owner: { kind: "revision", id: rev.id },
        stage: "LAYOUT",
        subkind: "REQUIREMENTS_DOC",
        kind: "NOTE",
        title: "wrong stage",
        noteBody: "body",
      }),
    ).rejects.toThrow(/not allowed at stage layout/i);
  });

  test("BRINGUP_COMPLETE at BRINGUP via the picker path is rejected (only the dedicated button creates it)", async () => {
    const rev = await makeRevAtStage(
      "BRINGUP",
      `t9.2-bringupcomplete-${Date.now()}`,
    );
    const build = await makeBuild(rev.id, `BUILD-BC-${Date.now()}`);

    // BRINGUP_COMPLETE is build-owned (passes ownerMatches) but NOT in
    // STAGES.BRINGUP.buildAllowedArtifactSubkinds — so createArtifact rejects
    // on the stage-allowed cross-check. This is the design §9.2 guarantee
    // that BRINGUP_COMPLETE creation flows only through markBringupComplete.
    await expect(
      createArtifact({
        owner: { kind: "build", id: build.id },
        stage: "BRINGUP",
        subkind: "BRINGUP_COMPLETE",
        kind: "NOTE",
        title: "should-not-create",
        noteBody: "body",
      }),
    ).rejects.toThrow(/not allowed at stage bringup/i);
  });

  test("frozen revision: rejected", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-frozenrev-${Date.now()}`,
    );
    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      createArtifact({
        owner: { kind: "revision", id: rev.id },
        stage: "REQUIREMENTS",
        subkind: "REQUIREMENTS_DOC",
        kind: "NOTE",
        title: "should fail",
        noteBody: "body",
      }),
    ).rejects.toThrow(/frozen/i);
  });

  test("frozen build: rejected", async () => {
    const rev = await makeRevAtStage(
      "ORDERING",
      `t9.2-frozenbuild-rev-${Date.now()}`,
    );
    const build = await makeBuild(rev.id, `BUILD-FBLD-${Date.now()}`);
    await db.build.update({
      where: { id: build.id },
      data: { frozenAt: new Date() },
    });

    await expect(
      createArtifact({
        owner: { kind: "build", id: build.id },
        stage: "ORDERING",
        subkind: "PCB_ORDER",
        kind: "LINK",
        title: "should fail",
        linkUrl: "https://example.com",
      }),
    ).rejects.toThrow(/build is frozen/i);
  });
});

// ─── editArtifact ──────────────────────────────────────

describe("editArtifact", () => {
  test("edit title on unfrozen NOTE artifact: succeeds", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-edit-${Date.now()}`,
    );

    const created = await createArtifact({
      owner: { kind: "revision", id: rev.id },
      stage: "REQUIREMENTS",
      subkind: "REQUIREMENTS_DOC",
      kind: "NOTE",
      title: "original",
      noteBody: "body",
    });
    createdArtifactIds.push(created.id);

    const updated = await editArtifact({
      id: created.id,
      title: "updated title",
      noteBody: "new body",
    });

    expect(updated.title).toBe("updated title");
    expect(updated.noteBody).toBe("new body");
  });

  test("edit on frozen revision: rejected", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-editfrozen-${Date.now()}`,
    );

    const created = await createArtifact({
      owner: { kind: "revision", id: rev.id },
      stage: "REQUIREMENTS",
      subkind: "REQUIREMENTS_DOC",
      kind: "NOTE",
      title: "original",
      noteBody: "body",
    });
    createdArtifactIds.push(created.id);

    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(
      editArtifact({ id: created.id, title: "should fail" }),
    ).rejects.toThrow(/frozen/i);
  });
});

// ─── deleteArtifact ────────────────────────────────────

describe("deleteArtifact", () => {
  test("delete on unfrozen: succeeds", async () => {
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-del-${Date.now()}`,
    );

    const created = await createArtifact({
      owner: { kind: "revision", id: rev.id },
      stage: "REQUIREMENTS",
      subkind: "REQUIREMENTS_DOC",
      kind: "NOTE",
      title: "to delete",
      noteBody: "body",
    });

    const result = await deleteArtifact({ id: created.id });
    expect(result.ok).toBe(true);

    const after = await db.artifact.findUnique({ where: { id: created.id } });
    expect(after).toBeNull();
  });

  test("delete on frozen revision: rejected", async () => {
    const user = await seedUser();
    const rev = await makeRevAtStage(
      "REQUIREMENTS",
      `t9.2-delfrozen-${Date.now()}`,
    );

    const created = await createArtifact({
      owner: { kind: "revision", id: rev.id },
      stage: "REQUIREMENTS",
      subkind: "REQUIREMENTS_DOC",
      kind: "NOTE",
      title: "to delete",
      noteBody: "body",
    });
    createdArtifactIds.push(created.id);

    await db.revision.update({
      where: { id: rev.id },
      data: { frozenAt: new Date(), frozenById: user.id },
    });

    await expect(deleteArtifact({ id: created.id })).rejects.toThrow(
      /frozen/i,
    );
  });
});
