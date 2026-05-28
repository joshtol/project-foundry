import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/lib/db";

// Concurrency proof for the partial unique index build_one_unfrozen_per_revision.
// Two transactions race to insert an unfrozen Build on the SAME Revision under
// Serializable isolation; exactly one must succeed.

const USER_ID = "build-unfrozen-concurrent-user";
const PROJECT_ID = "build-unfrozen-concurrent-project";
const REVISION_ID = "build-unfrozen-concurrent-rev";
const BUILD_X_ID = "build-unfrozen-concurrent-x";
const BUILD_Y_ID = "build-unfrozen-concurrent-y";

beforeAll(async () => {
  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id, email, "createdAt")
    VALUES ('${USER_ID}', 'build-unfrozen-concurrent@test.local', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Project" (id, slug, name, "createdById", "createdAt", "updatedAt")
    VALUES ('${PROJECT_ID}', 'build-unfrozen-concurrent-project', 'Build Unfrozen Concurrent Project', '${USER_ID}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "Revision" (id, "projectId", label, "currentStage", "currentStageEnteredAt", "createdAt", "updatedAt")
    VALUES ('${REVISION_ID}', '${PROJECT_ID}', 'build-unfrozen-concurrent-v1', 'ASSEMBLY', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM "Build" WHERE id IN ('${BUILD_X_ID}', '${BUILD_Y_ID}');`,
  );
  await db.$executeRawUnsafe(`DELETE FROM "Revision" WHERE id = '${REVISION_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id = '${PROJECT_ID}';`);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${USER_ID}';`);
});

test("INDEX build_one_unfrozen_per_revision: two concurrent unfrozen inserts on same Revision — exactly one survives", async () => {
  const makeTx = (buildId: string, label: string) =>
    db.$transaction(
      async (tx) => {
        await tx.build.create({
          data: {
            id: buildId,
            revisionId: REVISION_ID,
            label,
            boardCount: 3,
            createdById: USER_ID,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );

  const results = await Promise.allSettled([
    makeTx(BUILD_X_ID, "BUILD-CONC-X"),
    makeTx(BUILD_Y_ID, "BUILD-CONC-Y"),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  // Exactly one transaction must commit; the other must fail.
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);

  // The rejection must be Postgres's unique-violation on the partial index, or a
  // Serializable serialization_failure (40001). Either is the database doing its
  // job under contention.
  const errMsg = String(rejected[0].reason?.message ?? rejected[0].reason);
  expect(errMsg).toMatch(/build_one_unfrozen_per_revision|unique|serialization_failure|40001/i);

  // Confirm the steady-state invariant: exactly one unfrozen Build on this Revision.
  const unfrozen = await db.build.findMany({
    where: { revisionId: REVISION_ID, frozenAt: null },
  });
  expect(unfrozen).toHaveLength(1);
});
