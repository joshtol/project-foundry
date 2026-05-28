import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/lib/db";

// Partial unique index build_one_unfrozen_per_revision enforces at most one
// unfrozen Build per Revision: UNIQUE(revisionId) WHERE frozenAt IS NULL.
// Seeded: 1 User + 1 Project + 2 Revisions (so we can prove the index scopes
// to revisionId).

const USER_ID = "build-unfrozen-user";
const PROJECT_ID = "build-unfrozen-project";
const REVISION_A_ID = "build-unfrozen-rev-a";
const REVISION_B_ID = "build-unfrozen-rev-b";
const BUILD_A1_ID = "build-unfrozen-a1"; // unfrozen on rev A
const BUILD_A2_ID = "build-unfrozen-a2"; // second unfrozen on rev A — must reject
const BUILD_A3_ID = "build-unfrozen-a3"; // succeeds AFTER A1 is frozen
const BUILD_B1_ID = "build-unfrozen-b1"; // unfrozen on rev B — must succeed

beforeAll(async () => {
  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id, email, "createdAt")
    VALUES ('${USER_ID}', 'build-unfrozen@test.local', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_ID}', 'build-unfrozen-project', 'Build Unfrozen Project', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_A_ID}', '${PROJECT_ID}', 'build-unfrozen-vA', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_B_ID}', '${PROJECT_ID}', 'build-unfrozen-vB', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM "Build" WHERE id IN ('${BUILD_A1_ID}', '${BUILD_A2_ID}', '${BUILD_A3_ID}', '${BUILD_B1_ID}');`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM "Revision" WHERE id IN ('${REVISION_A_ID}', '${REVISION_B_ID}');`,
  );
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id = '${PROJECT_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${USER_ID}';`);
});

test("INDEX build_one_unfrozen_per_revision: first unfrozen Build on revision A succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_A1_ID}', '${REVISION_A_ID}', 'BUILD-001', 3, '${USER_ID}', NOW(), NOW());
  `);
  expect(result).toBe(1);
});

test("INDEX build_one_unfrozen_per_revision: second unfrozen Build on revision A is rejected", async () => {
  await expect(
    db.$executeRawUnsafe(`
      INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
      VALUES ('${BUILD_A2_ID}', '${REVISION_A_ID}', 'BUILD-002', 3, '${USER_ID}', NOW(), NOW());
    `),
  ).rejects.toThrow(/build_one_unfrozen_per_revision|unique/i);
});

test("INDEX build_one_unfrozen_per_revision: after freezing BUILD-001, a new unfrozen Build on revision A succeeds", async () => {
  await db.$executeRawUnsafe(
    `UPDATE "Build" SET "frozenAt" = NOW() WHERE id = '${BUILD_A1_ID}';`,
  );
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_A3_ID}', '${REVISION_A_ID}', 'BUILD-003', 3, '${USER_ID}', NOW(), NOW());
  `);
  expect(result).toBe(1);
});

test("INDEX build_one_unfrozen_per_revision: an unfrozen Build on a DIFFERENT revision B succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_B1_ID}', '${REVISION_B_ID}', 'BUILD-001', 3, '${USER_ID}', NOW(), NOW());
  `);
  expect(result).toBe(1);
});
