import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/lib/db";

// Functional unique index board_build_serial_ci enforces case-insensitive
// uniqueness of Board.serial per Build.
// Seed: 1 User + 1 Project + 1 Revision + 2 Builds to exercise the
// positive cross-build case.

const USER_ID = "board-serial-ci-user";
const PROJECT_ID = "board-serial-ci-project";
const REVISION_ID = "board-serial-ci-rev";
const BUILD_A_ID = "board-serial-ci-build-a";
const BUILD_B_ID = "board-serial-ci-build-b";
const BOARD_A1_ID = "board-serial-ci-a1"; // "B01" on build A
const BOARD_A2_ID = "board-serial-ci-a2"; // "b01" on build A — must reject
const BOARD_B1_ID = "board-serial-ci-b1"; // "b01" on build B — must succeed

beforeAll(async () => {
  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id, email, "createdAt")
    VALUES ('${USER_ID}', 'board-serial-ci@test.local', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_ID}', 'board-serial-ci-project', 'Board Serial CI Project', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_ID}', '${PROJECT_ID}', 'board-serial-ci-v1', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  // Insert Build A frozen so the partial unique index
  // build_one_unfrozen_per_revision allows Build B (unfrozen) on the same Revision.
  await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "frozenAt", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_A_ID}', '${REVISION_ID}', 'board-serial-ci-buildA', 3, NOW(), '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Build" (id, "revisionId", label, "boardCount", "createdById", "createdAt", "updatedAt")
    VALUES ('${BUILD_B_ID}', '${REVISION_ID}', 'board-serial-ci-buildB', 3, '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM "Board" WHERE id IN ('${BOARD_A1_ID}', '${BOARD_A2_ID}', '${BOARD_B1_ID}');`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM "Build" WHERE id IN ('${BUILD_A_ID}', '${BUILD_B_ID}');`,
  );
  await db.$executeRawUnsafe(`DELETE FROM "Revision" WHERE id = '${REVISION_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id = '${PROJECT_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${USER_ID}';`);
});

test("INDEX board_build_serial_ci: first 'B01' on build A succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Board" (id, "buildId", serial, status, "createdAt", "updatedAt")
    VALUES ('${BOARD_A1_ID}', '${BUILD_A_ID}', 'B01', 'BARE', NOW(), NOW());
  `);
  expect(result).toBe(1);
});

test("INDEX board_build_serial_ci: 'b01' on same build A is rejected", async () => {
  await expect(
    db.$executeRawUnsafe(`
      INSERT INTO "Board" (id, "buildId", serial, status, "createdAt", "updatedAt")
      VALUES ('${BOARD_A2_ID}', '${BUILD_A_ID}', 'b01', 'BARE', NOW(), NOW());
    `),
  ).rejects.toThrow(/board_build_serial_ci|unique/i);
});

test("INDEX board_build_serial_ci: 'b01' on a DIFFERENT build B succeeds", async () => {
  const result = await db.$executeRawUnsafe(`
    INSERT INTO "Board" (id, "buildId", serial, status, "createdAt", "updatedAt")
    VALUES ('${BOARD_B1_ID}', '${BUILD_B_ID}', 'b01', 'BARE', NOW(), NOW());
  `);
  expect(result).toBe(1);
});
