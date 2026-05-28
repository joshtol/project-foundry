import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/lib/db";

// Functional unique index revision_project_label_ci enforces case-insensitive
// uniqueness of Revision.label per Project.
// Seed: 1 User + 2 Projects so we can also exercise the positive path
// (same lowercase label is fine in a *different* project).

const USER_ID = "rev-label-ci-user";
const PROJECT_A_ID = "rev-label-ci-project-a";
const PROJECT_B_ID = "rev-label-ci-project-b";
const REV_A1_ID = "rev-label-ci-a1"; // "V1" on project A
const REV_A2_ID = "rev-label-ci-a2"; // "v1" on project A — must reject
const REV_B1_ID = "rev-label-ci-b1"; // "v1" on project B — must succeed

beforeAll(async () => {
  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id, email, "createdAt")
    VALUES ('${USER_ID}', 'rev-label-ci@test.local', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_A_ID}', 'rev-label-ci-project-a', 'Rev Label CI Project A', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_B_ID}', 'rev-label-ci-project-b', 'Rev Label CI Project B', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM "Revision" WHERE id IN ('${REV_A1_ID}', '${REV_A2_ID}', '${REV_B1_ID}');`,
  );
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id IN ('${PROJECT_A_ID}', '${PROJECT_B_ID}');`);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${USER_ID}';`);
});

test("INDEX revision_project_label_ci: first Revision 'V1' on project A succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REV_A1_ID}', '${PROJECT_A_ID}', 'V1', 'REQUIREMENTS', NOW(), NOW(), NOW());
  `);
  expect(result).toBe(1);
});

test("INDEX revision_project_label_ci: 'v1' on same project A is rejected", async () => {
  await expect(
    db.$executeRawUnsafe(`
      INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
      VALUES ('${REV_A2_ID}', '${PROJECT_A_ID}', 'v1', 'REQUIREMENTS', NOW(), NOW(), NOW());
    `),
  ).rejects.toThrow(/revision_project_label_ci|unique/i);
});

test("INDEX revision_project_label_ci: 'v1' on a DIFFERENT project B succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REV_B1_ID}', '${PROJECT_B_ID}', 'v1', 'REQUIREMENTS', NOW(), NOW(), NOW());
  `);
  expect(result).toBe(1);
});
