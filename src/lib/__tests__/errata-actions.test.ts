// Tests for Erratum server actions (Task 11.1).
//
// Exercises the real Neon DB; mocks `next/cache` and `@/auth` per the same
// pattern as the other action tests.
//
// Critical design rule: errata are the POST-FREEZE WRITE PATH (design §5.3).
// `createErratum` MUST succeed on a frozen revision — that's the key
// invariant under test in the "post-freeze write path" group.
//
// Coverage:
//   - createErratum on a non-frozen revision → success.
//   - createErratum on a FROZEN revision → success (the design rule).
//   - createErratum with cross-project addressedByRevisionId → rejected with
//     the canonical message.
//   - linkErratumToRevision: same project → success.
//   - linkErratumToRevision: cross project → rejected with canonical message.
//   - editErratum updates fields, writes updatedAt.
//   - deleteErratum removes the row.
//   - Severity enum values validate (BLOCKER/MAJOR/MINOR).
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
  createErratum,
  deleteErratum,
  editErratum,
  linkErratumToRevision,
} from "@/lib/actions/errata";
import { CROSS_PROJECT_ERRATUM_MSG } from "@/lib/schemas/erratum";

const SEED_EMAIL = "seed@example.com";
const SEED_PROJECT_SLUG = "esp32-sensor-breakout";

const createdErratumIds: string[] = [];
const createdRevisionIds: string[] = [];
const createdProjectIds: string[] = [];

beforeAll(() => {
  mockAuth.mockImplementation(async () => ({
    user: { email: SEED_EMAIL },
  }));
});

afterAll(async () => {
  if (createdErratumIds.length > 0) {
    await db.erratum.deleteMany({
      where: { id: { in: createdErratumIds } },
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

async function makeRev(label: string, projectId?: string) {
  const project = projectId
    ? await db.project.findUniqueOrThrow({ where: { id: projectId } })
    : await db.project.findUniqueOrThrow({ where: { slug: SEED_PROJECT_SLUG } });
  const rev = await db.revision.create({
    data: {
      projectId: project.id,
      label,
      currentStage: "REQUIREMENTS",
    },
  });
  createdRevisionIds.push(rev.id);
  return rev;
}

async function makeFrozenRev(label: string) {
  const user = await seedUser();
  const rev = await makeRev(label);
  await db.revision.update({
    where: { id: rev.id },
    data: {
      frozenAt: new Date(),
      frozenById: user.id,
      currentStage: "REVISION",
    },
  });
  return db.revision.findUniqueOrThrow({ where: { id: rev.id } });
}

async function makeForeignProjectRev(label: string) {
  const user = await seedUser();
  const slug = `errata-test-foreign-${Date.now()}`;
  const project = await db.project.create({
    data: {
      slug,
      name: "errata test foreign",
      createdById: user.id,
    },
  });
  createdProjectIds.push(project.id);
  const rev = await db.revision.create({
    data: {
      projectId: project.id,
      label,
      currentStage: "REQUIREMENTS",
    },
  });
  createdRevisionIds.push(rev.id);
  return rev;
}

// ─── createErratum ─────────────────────────────────────

describe("createErratum — happy paths", () => {
  test("non-frozen revision: creates erratum and stamps createdBy", async () => {
    const user = await seedUser();
    const rev = await makeRev(`t11.1-create-${Date.now()}`);

    const e = await createErratum({
      revisionId: rev.id,
      title: "PWR rail noisy",
      description: "VBUS ringing on plug-in.",
      severity: "MAJOR",
    });
    createdErratumIds.push(e.id);

    expect(e.revisionId).toBe(rev.id);
    expect(e.title).toBe("PWR rail noisy");
    expect(e.description).toBe("VBUS ringing on plug-in.");
    expect(e.severity).toBe("MAJOR");
    expect(e.status).toBe("OPEN");
    expect(e.addressedByRevisionId).toBeNull();
    expect(e.createdById).toBe(user.id);
  });

  test("severity enum: all three values accepted", async () => {
    const rev = await makeRev(`t11.1-sev-${Date.now()}`);

    for (const severity of ["BLOCKER", "MAJOR", "MINOR"] as const) {
      const e = await createErratum({
        revisionId: rev.id,
        title: `sev ${severity}`,
        description: "x",
        severity,
      });
      createdErratumIds.push(e.id);
      expect(e.severity).toBe(severity);
    }
  });
});

describe("createErratum — post-freeze write path (design §5.3)", () => {
  test("FROZEN revision: createErratum succeeds (errata bypass assertNotFrozen)", async () => {
    const rev = await makeFrozenRev(`t11.1-frozen-${Date.now()}`);
    // Sanity: the rev is actually frozen.
    expect(rev.frozenAt).not.toBeNull();
    expect(rev.currentStage).toBe("REVISION");

    const e = await createErratum({
      revisionId: rev.id,
      title: "Post-freeze finding",
      description: "Discovered after freeze — that's why errata exist.",
      severity: "BLOCKER",
    });
    createdErratumIds.push(e.id);

    expect(e.revisionId).toBe(rev.id);
    expect(e.severity).toBe("BLOCKER");
  });
});

describe("createErratum — rejection paths", () => {
  test("invalid severity value: Zod rejects", async () => {
    const rev = await makeRev(`t11.1-badsev-${Date.now()}`);
    await expect(
      createErratum({
        revisionId: rev.id,
        title: "x",
        description: "y",
        severity: "CATASTROPHIC", // not in the enum
      }),
    ).rejects.toThrow();
  });

  test("empty title: Zod rejects", async () => {
    const rev = await makeRev(`t11.1-empty-${Date.now()}`);
    await expect(
      createErratum({
        revisionId: rev.id,
        title: "",
        description: "y",
        severity: "MAJOR",
      }),
    ).rejects.toThrow();
  });

  test("cross-project addressedByRevisionId at create: rejected with canonical message", async () => {
    const sourceRev = await makeRev(`t11.1-srcXp-${Date.now()}`);
    const foreignRev = await makeForeignProjectRev(`t11.1-fgnXp-${Date.now()}`);

    await expect(
      createErratum({
        revisionId: sourceRev.id,
        title: "cross-project at create",
        description: "should fail",
        severity: "MINOR",
        addressedByRevisionId: foreignRev.id,
      }),
    ).rejects.toThrow(CROSS_PROJECT_ERRATUM_MSG);
  });
});

// ─── linkErratumToRevision ─────────────────────────────

describe("linkErratumToRevision", () => {
  test("same project: succeeds and writes addressedByRevisionId", async () => {
    const srcRev = await makeRev(`t11.1-linksrc-${Date.now()}`);
    const tgtRev = await makeRev(`t11.1-linktgt-${Date.now()}`);

    const e = await createErratum({
      revisionId: srcRev.id,
      title: "linkable",
      description: "x",
      severity: "MAJOR",
    });
    createdErratumIds.push(e.id);

    const linked = await linkErratumToRevision({
      id: e.id,
      addressedByRevisionId: tgtRev.id,
    });

    expect(linked.addressedByRevisionId).toBe(tgtRev.id);
  });

  test("cross project: rejected with canonical message", async () => {
    const srcRev = await makeRev(`t11.1-linkXpsrc-${Date.now()}`);
    const foreignRev = await makeForeignProjectRev(
      `t11.1-linkXpfgn-${Date.now()}`,
    );

    const e = await createErratum({
      revisionId: srcRev.id,
      title: "should not link cross-project",
      description: "x",
      severity: "BLOCKER",
    });
    createdErratumIds.push(e.id);

    await expect(
      linkErratumToRevision({
        id: e.id,
        addressedByRevisionId: foreignRev.id,
      }),
    ).rejects.toThrow(CROSS_PROJECT_ERRATUM_MSG);
  });
});

// ─── editErratum ───────────────────────────────────────

describe("editErratum", () => {
  test("updates fields and bumps updatedAt", async () => {
    const rev = await makeRev(`t11.1-edit-${Date.now()}`);
    const e = await createErratum({
      revisionId: rev.id,
      title: "before",
      description: "before desc",
      severity: "MINOR",
    });
    createdErratumIds.push(e.id);
    const beforeUpdatedAt = e.updatedAt;
    // Sleep 5ms so updatedAt strictly advances; Postgres now() is microsecond
    // precision but Prisma's @updatedAt collapses to millisecond.
    await new Promise((r) => setTimeout(r, 5));

    const updated = await editErratum({
      id: e.id,
      title: "after",
      description: "after desc",
      severity: "BLOCKER",
      status: "WONT_FIX",
    });

    expect(updated.title).toBe("after");
    expect(updated.description).toBe("after desc");
    expect(updated.severity).toBe("BLOCKER");
    expect(updated.status).toBe("WONT_FIX");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      beforeUpdatedAt.getTime(),
    );
  });

  test("editErratum on FROZEN revision: succeeds (post-freeze write path)", async () => {
    const rev = await makeFrozenRev(`t11.1-editfroz-${Date.now()}`);
    const e = await createErratum({
      revisionId: rev.id,
      title: "frozen-edit",
      description: "x",
      severity: "MAJOR",
    });
    createdErratumIds.push(e.id);

    const updated = await editErratum({
      id: e.id,
      title: "still editable post-freeze",
    });
    expect(updated.title).toBe("still editable post-freeze");
  });

  test("edit cross-project link: rejected with canonical message", async () => {
    const sourceRev = await makeRev(`t11.1-editXpsrc-${Date.now()}`);
    const foreignRev = await makeForeignProjectRev(
      `t11.1-editXpfgn-${Date.now()}`,
    );

    const e = await createErratum({
      revisionId: sourceRev.id,
      title: "should not edit link cross-project",
      description: "x",
      severity: "MINOR",
    });
    createdErratumIds.push(e.id);

    await expect(
      editErratum({
        id: e.id,
        addressedByRevisionId: foreignRev.id,
      }),
    ).rejects.toThrow(CROSS_PROJECT_ERRATUM_MSG);
  });
});

// ─── deleteErratum ─────────────────────────────────────

describe("deleteErratum", () => {
  test("removes the row", async () => {
    const rev = await makeRev(`t11.1-del-${Date.now()}`);
    const e = await createErratum({
      revisionId: rev.id,
      title: "to delete",
      description: "x",
      severity: "MINOR",
    });

    const result = await deleteErratum({ id: e.id });
    expect(result.ok).toBe(true);

    const after = await db.erratum.findUnique({ where: { id: e.id } });
    expect(after).toBeNull();
  });

  test("delete on FROZEN revision: succeeds (post-freeze write path)", async () => {
    const rev = await makeFrozenRev(`t11.1-delfroz-${Date.now()}`);
    const e = await createErratum({
      revisionId: rev.id,
      title: "to delete (frozen)",
      description: "x",
      severity: "MINOR",
    });

    const result = await deleteErratum({ id: e.id });
    expect(result.ok).toBe(true);
  });
});
