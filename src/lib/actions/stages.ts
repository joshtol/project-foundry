"use server";

// Stage state-machine server actions (design §5.3).
//
// Phase 8 / M7: `advanceStage` (this task) + `regressStage` (Task 8.2).
// Both run inside `db.$transaction({ isolationLevel: "Serializable" })`
// wrapped by `withTxRetry` per the §5.3 framing. The conditional UPDATE
// (`WHERE id = $id AND "currentStage" = $expected`) is defense-in-depth
// against cross-request races whose transactions already committed —
// Serializable's SSI handles the in-flight overlap, the row-count check
// catches the resolved-but-stale case.
//
// gateSnapshot blobs are tagged `{ v: 1, kind: ... }` per the discriminated
// union in `src/lib/stages.ts`. Bump the version when the shape changes.

import { Prisma, type Stage } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { withTxRetry } from "@/lib/tx-retry";
import { loadGateContext } from "@/lib/load-gate-context";
import {
  STAGES,
  STAGE_ORDER,
  type GateResult,
  type StageName,
} from "@/lib/stages";

// ─── Result shape ──────────────────────────────────────
//
// Action returns a discriminated result. Gate failure is NOT thrown —
// the caller surfaces `reasons` inline (design §9.1). Other policy
// violations throw normally so the form's error banner renders them.

export type AdvanceStageResult =
  | {
      ok: true;
      transition: {
        id: string;
        fromStage: Stage | null;
        toStage: Stage;
        direction: "ADVANCE";
        transitionedAt: Date;
      };
    }
  | { ok: false; reasons: string[] };

export type RegressStageResult =
  | {
      ok: true;
      transition: {
        id: string;
        fromStage: Stage | null;
        toStage: Stage;
        direction: "REGRESS";
        transitionedAt: Date;
      };
    }
  | { ok: false; reasons: string[] };

// ─── Schemas ───────────────────────────────────────────

const advanceStageSchema = z.object({
  revisionId: z.cuid(),
  notes: z.string().max(2000).optional(),
});

const regressStageSchema = z.object({
  revisionId: z.cuid(),
  reason: z.string().trim().min(1, "reason is required").max(2000),
});

// ─── Helpers ───────────────────────────────────────────

async function loadRevisionRoute(revisionId: string) {
  const rev = await db.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      label: true,
      project: { select: { slug: true } },
    },
  });
  return {
    projectSlug: rev.project.slug,
    revLabel: rev.label,
  };
}

function nextStage(current: StageName): StageName | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1]!;
}

function prevStage(current: StageName): StageName | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return STAGE_ORDER[idx - 1]!;
}

// ─── advanceStage ──────────────────────────────────────

export async function advanceStage(
  input: unknown,
): Promise<AdvanceStageResult> {
  const data = advanceStageSchema.parse(input);
  const user = await requireUser();

  const { result, projectSlug, revLabel } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        // 1. Load revision (with project slug for revalidation).
        const rev = await tx.revision.findUniqueOrThrow({
          where: { id: data.revisionId },
          select: {
            id: true,
            label: true,
            currentStage: true,
            frozenAt: true,
            project: { select: { slug: true } },
          },
        });

        // 2. Reject if frozen.
        if (rev.frozenAt !== null) {
          throw new Error("Revision is frozen.");
        }

        // 3. Reject if at terminal stage.
        const currentStage = rev.currentStage as StageName;
        if (currentStage === "REVISION") {
          throw new Error(
            "Revision is at REVISION (terminal); cannot advance.",
          );
        }

        const toStage = nextStage(currentStage);
        if (!toStage) {
          // Defensive — terminal case is already handled above.
          throw new Error(
            `Cannot advance: no next stage after ${currentStage}.`,
          );
        }

        // 4. Run the exit gate. Build context inside the same tx so SSI
        //    picks up any concurrent writes to boards / artifacts / etc.
        const ctx = await loadGateContext(tx, rev.id);
        const gate = STAGES[currentStage].exitGate;
        const gateResult: GateResult = gate
          ? await gate(ctx)
          : { ok: true };
        if (!gateResult.ok) {
          // Return — don't throw — so the caller can render `reasons`
          // inline. The tx will commit cleanly with no state change.
          return {
            result: { ok: false as const, reasons: gateResult.reasons },
            projectSlug: rev.project.slug,
            revLabel: rev.label,
          };
        }

        // 5. Conditional UPDATE — defense-in-depth against cross-request
        //    races whose tx already committed before this one started.
        //    Build the SQL parameters per side-effect on toStage:
        //      - LAYOUT  → bomFrozenAt = NOW()
        //      - REVISION → frozenAt = NOW(), frozenById = user.id
        const now = new Date();
        let rowCount: number;
        if (toStage === "LAYOUT") {
          rowCount = await tx.$executeRaw`
            UPDATE "Revision"
            SET "currentStage" = ${toStage}::"Stage",
                "currentStageEnteredAt" = ${now},
                "bomFrozenAt" = ${now}
            WHERE "id" = ${rev.id}
              AND "currentStage" = ${currentStage}::"Stage"
          `;
        } else if (toStage === "REVISION") {
          rowCount = await tx.$executeRaw`
            UPDATE "Revision"
            SET "currentStage" = ${toStage}::"Stage",
                "currentStageEnteredAt" = ${now},
                "frozenAt" = ${now},
                "frozenById" = ${user.id}
            WHERE "id" = ${rev.id}
              AND "currentStage" = ${currentStage}::"Stage"
          `;
        } else {
          rowCount = await tx.$executeRaw`
            UPDATE "Revision"
            SET "currentStage" = ${toStage}::"Stage",
                "currentStageEnteredAt" = ${now}
            WHERE "id" = ${rev.id}
              AND "currentStage" = ${currentStage}::"Stage"
          `;
        }

        if (rowCount === 0) {
          throw new Error(
            "Stale state — another user advanced this revision; refresh.",
          );
        }

        // 6. Build freeze cascade — Phase 1 invariant: 0 or 1 unfrozen
        //    Build per Revision. If REVISION is entered, freeze the
        //    active Build in the same tx.
        if (toStage === "REVISION") {
          const activeBuild = await tx.build.findFirst({
            where: { revisionId: rev.id, frozenAt: null },
            select: { id: true },
          });
          if (activeBuild) {
            await tx.build.update({
              where: { id: activeBuild.id },
              data: { frozenAt: now },
            });
          }
        }

        // 7. Insert StageTransition. gateSnapshot carries the result for
        //    audit + future click-to-expand UI (design §9.1).
        const transition = await tx.stageTransition.create({
          data: {
            revisionId: rev.id,
            fromStage: currentStage as Stage,
            toStage: toStage as Stage,
            direction: "ADVANCE",
            notes: data.notes ?? null,
            gateSnapshot: {
              v: 1,
              kind: "gate",
              result: gateResult,
              ts: now.toISOString(),
            },
            transitionedBy: user.id,
          },
          select: {
            id: true,
            fromStage: true,
            toStage: true,
            direction: true,
            transitionedAt: true,
          },
        });

        return {
          result: {
            ok: true as const,
            transition: {
              id: transition.id,
              fromStage: transition.fromStage,
              toStage: transition.toStage,
              direction: "ADVANCE" as const,
              transitionedAt: transition.transitionedAt,
            },
          },
          projectSlug: rev.project.slug,
          revLabel: rev.label,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  revalidatePath(`/projects/${projectSlug}/${revLabel}`);
  return result;
}

// ─── regressStage ──────────────────────────────────────

export async function regressStage(
  input: unknown,
): Promise<RegressStageResult> {
  const data = regressStageSchema.parse(input);
  const user = await requireUser();

  const { result, projectSlug, revLabel } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const rev = await tx.revision.findUniqueOrThrow({
          where: { id: data.revisionId },
          select: {
            id: true,
            label: true,
            currentStage: true,
            frozenAt: true,
            project: { select: { slug: true } },
          },
        });

        if (rev.frozenAt !== null) {
          throw new Error("Revision is frozen.");
        }

        const currentStage = rev.currentStage as StageName;
        if (currentStage === "REQUIREMENTS") {
          throw new Error(
            "Revision is at REQUIREMENTS; cannot regress further.",
          );
        }

        const toStage = prevStage(currentStage);
        if (!toStage) {
          throw new Error(
            `Cannot regress: no previous stage before ${currentStage}.`,
          );
        }

        const now = new Date();

        // Conditional UPDATE — same optimistic-lock pattern as advance.
        // Side-effect: regressing OUT of LAYOUT clears bomFrozenAt.
        // Regressing INTO LAYOUT (e.g., DRC_GERBER → LAYOUT) preserves it.
        let rowCount: number;
        if (currentStage === "LAYOUT" && toStage === "BOM_SOURCING") {
          rowCount = await tx.$executeRaw`
            UPDATE "Revision"
            SET "currentStage" = ${toStage}::"Stage",
                "currentStageEnteredAt" = ${now},
                "bomFrozenAt" = NULL
            WHERE "id" = ${rev.id}
              AND "currentStage" = ${currentStage}::"Stage"
          `;
        } else {
          rowCount = await tx.$executeRaw`
            UPDATE "Revision"
            SET "currentStage" = ${toStage}::"Stage",
                "currentStageEnteredAt" = ${now}
            WHERE "id" = ${rev.id}
              AND "currentStage" = ${currentStage}::"Stage"
          `;
        }

        if (rowCount === 0) {
          throw new Error(
            "Stale state — another user changed this revision; refresh.",
          );
        }

        const transition = await tx.stageTransition.create({
          data: {
            revisionId: rev.id,
            fromStage: currentStage as Stage,
            toStage: toStage as Stage,
            direction: "REGRESS",
            notes: data.reason,
            gateSnapshot: {
              v: 1,
              kind: "regress",
              reason: data.reason,
              ts: now.toISOString(),
            },
            transitionedBy: user.id,
          },
          select: {
            id: true,
            fromStage: true,
            toStage: true,
            direction: true,
            transitionedAt: true,
          },
        });

        return {
          result: {
            ok: true as const,
            transition: {
              id: transition.id,
              fromStage: transition.fromStage,
              toStage: transition.toStage,
              direction: "REGRESS" as const,
              transitionedAt: transition.transitionedAt,
            },
          },
          projectSlug: rev.project.slug,
          revLabel: rev.label,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  revalidatePath(`/projects/${projectSlug}/${revLabel}`);
  return result;
}

// ─── Form action wrappers (useActionState-compatible) ──────────────────

export type StageFormState = {
  errors?: Record<string, string[]>;
  message?: string;
  /** Gate-failure reasons rendered inline under the Advance button. */
  reasons?: string[];
};

export async function advanceStageAction(
  _prev: StageFormState,
  formData: FormData,
): Promise<StageFormState> {
  const revisionId = formData.get("revisionId");
  if (typeof revisionId !== "string" || revisionId.length === 0) {
    return { message: "Missing revisionId" };
  }
  const notesRaw = formData.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim()
      : undefined;
  try {
    const result = await advanceStage({ revisionId, notes });
    if (!result.ok) return { reasons: result.reasons };
    return {};
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_root";
        (errors[key] ??= []).push(issue.message);
      }
      return { errors };
    }
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function regressStageAction(
  _prev: StageFormState,
  formData: FormData,
): Promise<StageFormState> {
  const revisionId = formData.get("revisionId");
  if (typeof revisionId !== "string" || revisionId.length === 0) {
    return { message: "Missing revisionId" };
  }
  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw : "";
  try {
    const result = await regressStage({ revisionId, reason });
    if (!result.ok) return { reasons: result.reasons };
    return {};
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_root";
        (errors[key] ??= []).push(issue.message);
      }
      return { errors };
    }
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Imported to satisfy `tsc --noEmit` (loadRevisionRoute used in earlier
// drafts; left as a private helper for future reuse). Silences the linter.
void loadRevisionRoute;
