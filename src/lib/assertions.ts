// Freeze-policy assertion helpers (design §5.3).
//
// Phase 5a wired `assertNotFrozen` and `assertBomNotFrozen` for the BomLine /
// commit-SHA write paths. Phase 6 / M5b wires `assertBuildNotFrozen` for the
// Build-CRUD callers (editBuild); Phase 8 will reuse it for the Build-scoped
// artifact / checklist / measurement writers.
//
// Each helper takes a Prisma transaction client so they can run inside the
// Serializable transaction the action layer opens. Throwing here aborts
// the transaction.
//
// These checks are **policy-only** per design §5.3 — raw SQL can bypass.
// The DB enforces the one-unfrozen-Build-per-Revision invariant via a
// partial unique index (§12.1).
import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export async function assertNotFrozen(
  tx: TxClient,
  revisionId: string,
): Promise<void> {
  const rev = await tx.revision.findUnique({
    where: { id: revisionId },
    select: { frozenAt: true },
  });
  if (!rev) throw new Error("Revision not found.");
  if (rev.frozenAt !== null) {
    throw new Error("Revision is frozen.");
  }
}

export async function assertBomNotFrozen(
  tx: TxClient,
  revisionId: string,
): Promise<void> {
  const rev = await tx.revision.findUnique({
    where: { id: revisionId },
    select: { bomFrozenAt: true },
  });
  if (!rev) throw new Error("Revision not found.");
  if (rev.bomFrozenAt !== null) {
    throw new Error("BOM is frozen.");
  }
}

// `buildId | { buildId }` per §5.3 footnote: callers that already loaded
// the Board pass an object with a `buildId` field so they don't pay for
// the extra round-trip.
type BuildRef = string | { buildId: string | null };

export async function assertBuildNotFrozen(
  tx: TxClient,
  ref: BuildRef,
): Promise<void> {
  const buildId =
    typeof ref === "string"
      ? ref
      : (ref.buildId ?? null);
  if (!buildId) throw new Error("Missing buildId.");
  const build = await tx.build.findUnique({
    where: { id: buildId },
    select: { frozenAt: true },
  });
  if (!build) throw new Error("Build not found.");
  if (build.frozenAt !== null) {
    throw new Error("Build is frozen.");
  }
}
