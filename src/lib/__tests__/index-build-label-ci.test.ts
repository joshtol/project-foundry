import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/lib/db";

// Functional unique index build_revision_label_ci enforces case-insensitive
// uniqueness of Build.label per Revision.
// Seed: 1 User + 1 Project + 2 Revisions to exercise the positive cross-revision case.

const USER_ID = "build-label-ci-user";
const PROJECT_ID = "build-label-ci-project";
const REVISION_A_ID = "build-label-ci-rev-a";
const REVISION_B_ID = "build-label-ci-rev-b";
const BUILD_A1_ID = "build-label-ci-a1"; // "BUILD-001" on rev A
const BUILD_A2_ID = "build-label-ci-a2"; // "build-001" on rev A — must reject
const BUILD_B1_ID = "build-label-ci-b1"; // "build-001" on rev B — must succeed

beforeAll(async () => {
  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id, email, "createdAt")
    VALUES ('${USER_ID}', 'build-label-ci@test.local', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_ID}', 'build-label-ci-project', 'Build Label CI Project', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_A_ID}', '${PROJECT_ID}', 'build-label-ci-vA', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_B_ID}', '${PROJECT_ID}', 'build-label-ci-vB', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM "Build" WHERE id IN ('${BUILD_A1_ID}', '${BUILD_A2_ID}', '${BUILD_B1_ID}');`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM "Revision" WHERE id IN ('${REVISION_A_ID}', '${REVISION_B_ID}');`,
  );
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id = '${PROJECT_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${USER_ID}';`);
});

test("INDEX build_revision_label_ci: first 'BUILD-001' on revision A succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_A1_ID}', '${REVISION_A_ID}', 'BUILD-001', 3, '${USER_ID}', NOW(), NOW());
  `);
  expect(result).toBe(1);
});

test("INDEX build_revision_label_ci: 'build-001' on same revision A is rejected", async () => {
  await expect(
    db.$executeRawUnsafe(`
      INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
      VALUES ('${BUILD_A2_ID}', '${REVISION_A_ID}', 'build-001', 3, '${USER_ID}', NOW(), NOW());
    `),
  ).rejects.toThrow(/build_revision_label_ci|unique/i);
});

test("INDEX build_revision_label_ci: 'build-001' on a DIFFERENT revision B succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_B1_ID}', '${REVISION_B_ID}', 'build-001', 3, '${USER_ID}', NOW(), NOW());
  `);
  expect(result).toBe(1);
});
