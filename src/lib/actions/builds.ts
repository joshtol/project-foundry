"use server";

// Build server actions (design §5.3).
//
// Phase 6 / M5b: createBuild. The transition rules — and the rationale for
// the single-row regress that may skip stages — live in design §5.3 step 3.
//
// Critical invariants enforced here:
//   1. Revision not frozen (assertNotFrozen — symmetric with the rest of the
//      mutation surface).
//   2. Revision.currentStage ∈ {DRC_GERBER, ORDERING, ASSEMBLY, BRINGUP}.
//      Creating earlier than DRC_GERBER skips the design+DRC work that
//      makes ordering meaningful; REVISION is terminal.
//   3. At most one unfrozen Build per Revision (Phase 1 invariant). The
//      application check produces a friendly error; the partial unique
//      index `build_one_unfrozen_per_revision` is the defense-in-depth
//      backstop (raw SQL bypassing the action still hits it).
//   4. If current stage is past ORDERING, regress to ORDERING with ONE
//      StageTransition row (fromStage = current, toStage = ORDERING).
//
// Everything runs inside a Serializable transaction wrapped by withTxRetry
// per the §5.3 framing — SSI aborts concurrent unfrozen-Build inserts on the
// same Revision; the retry handles the rare conflict cleanly.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { assertBuildNotFrozen, assertNotFrozen } from "@/lib/assertions";
import { withTxRetry } from "@/lib/tx-retry";
import { STAGE_ORDER, type StageName } from "@/lib/stages";
import {
  createBuildSchema,
  editBuildSchema,
  type EditBuildInput,
} from "@/lib/schemas/build";

// Stages from which a new Build can be created. Earlier stages are rejected
// because PCB design isn't ready; REVISION is terminal.
const BUILD_CREATABLE_STAGES = new Set<StageName>([
  "DRC_GERBER",
  "ORDERING",
  "ASSEMBLY",
  "BRINGUP",
]);

async function loadBuildRoute(buildId: string) {
  const build = await db.build.findUniqueOrThrow({
    where: { id: buildId },
    select: {
      label: true,
      revision: {
        select: {
          label: true,
          project: { select: { slug: true } },
        },
      },
    },
  });
  return {
    projectSlug: build.revision.project.slug,
    revLabel: build.revision.label,
    buildLabel: build.label,
  };
}

export async function createBuild(input: unknown) {
  const data = createBuildSchema.parse(input);
  const user = await requireUser();

  const { build, projectSlug, revLabel } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        // 1. Load the revision (with project for revalidation path).
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

        // 2. Reject if frozen. Use assertNotFrozen for symmetry with the
        //    rest of the mutation surface (the explicit findUniqueOrThrow
        //    above is the load, the assert is the policy gate).
        await assertNotFrozen(tx, rev.id);

        // 3. Reject if stage doesn't permit Build creation.
        const currentStage = rev.currentStage as StageName;
        if (!BUILD_CREATABLE_STAGES.has(currentStage)) {
          throw new Error(
            `Cannot create Build at stage ${currentStage}. Allowed: DRC_GERBER, ORDERING, ASSEMBLY, BRINGUP.`,
          );
        }

        // 4. Phase 1 invariant: at most one unfrozen Build per Revision.
        //    The partial unique index is the DB safety net; this check is
        //    the friendly error path.
        const existingUnfrozen = await tx.build.findFirst({
          where: { revisionId: rev.id, frozenAt: null },
          select: { id: true, label: true },
        });
        if (existingUnfrozen) {
          throw new Error(
            `An unfrozen Build (${existingUnfrozen.label}) already exists; freeze or finish it first.`,
          );
        }

        // 5. If past ORDERING, regress with ONE StageTransition row. The row
        //    may span multiple stages (e.g., BRINGUP → ORDERING); the UI in
        //    §9.1 renders the from→to spread naturally.
        const stageIdx = STAGE_ORDER.indexOf(currentStage);
        const orderingIdx = STAGE_ORDER.indexOf("ORDERING");
        const needsRegress = stageIdx > orderingIdx;

        if (needsRegress) {
          const reason = `New Build ${data.label} created`;
          const now = new Date();
          await tx.revision.update({
            where: { id: rev.id },
            data: {
              currentStage: "ORDERING",
              currentStageEnteredAt: now,
            },
          });
          await tx.stageTransition.create({
            data: {
              revisionId: rev.id,
              fromStage: currentStage,
              toStage: "ORDERING",
              direction: "REGRESS",
              notes: reason,
              gateSnapshot: {
                v: 1,
                kind: "regress",
                reason,
                ts: now.toISOString(),
              },
              transitionedBy: user.id,
            },
          });
        }

        // 6. Insert the Build row.
        const newBuild = await tx.build.create({
          data: {
            revisionId: rev.id,
            label: data.label,
            boardCount: data.boardCount,
            createdById: user.id,
          },
        });

        return {
          build: newBuild,
          projectSlug: rev.project.slug,
          revLabel: rev.label,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  // Revalidate the parent revision page (the Builds pane will pick up the
  // new row + any regress that fired).
  revalidatePath(`/projects/${projectSlug}/${revLabel}`);

  return build;
}

// ─── Build header edits (design §9.2 inline-save) ──────────────────────
//
// One server action per "logical field group"; the dates share a path because
// they're toggled by the same UI control set. All wrap assertNotFrozen +
// assertBuildNotFrozen so a freeze takes effect immediately for in-flight
// edits.

function coerceDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new Error("Invalid date value");
    }
    return d;
  }
  throw new Error("Invalid date value");
}

function coerceTextOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new Error("Invalid text value");
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function editBuild(input: unknown) {
  const parsed: EditBuildInput = editBuildSchema.parse(input);
  await requireUser();

  // Normalize the partial update payload. Fields the caller didn't supply
  // are left untouched; empty strings on optional fields clear them.
  const data: Record<string, unknown> = {};
  if (parsed.pcbOrderRef !== undefined) {
    data.pcbOrderRef = coerceTextOrNull(parsed.pcbOrderRef);
  }
  if (parsed.partsOrderRef !== undefined) {
    data.partsOrderRef = coerceTextOrNull(parsed.partsOrderRef);
  }
  if (parsed.orderedAt !== undefined) {
    data.orderedAt = coerceDate(parsed.orderedAt);
  }
  if (parsed.receivedAt !== undefined) {
    data.receivedAt = coerceDate(parsed.receivedAt);
  }
  if (parsed.assemblyStartedAt !== undefined) {
    data.assemblyStartedAt = coerceDate(parsed.assemblyStartedAt);
  }
  if (parsed.notes !== undefined) {
    data.notes = coerceTextOrNull(parsed.notes);
  }

  const updated = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const build = await tx.build.findUniqueOrThrow({
          where: { id: parsed.id },
          select: { revisionId: true },
        });
        await assertNotFrozen(tx, build.revisionId);
        await assertBuildNotFrozen(tx, parsed.id);
        return tx.build.update({ where: { id: parsed.id }, data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadBuildRoute(updated.id);
  revalidatePath(
    `/projects/${route.projectSlug}/${route.revLabel}/builds/${route.buildLabel}`,
  );
  return updated;
}

// ─── Form action wrappers (useActionState-compatible) ──────────────────

export type BuildFormState = {
  errors?: Record<string, string[]>;
  message?: string;
};

function pickString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  return v.trim();
}

async function editBuildSingleField(
  fieldName:
    | "pcbOrderRef"
    | "partsOrderRef"
    | "orderedAt"
    | "receivedAt"
    | "assemblyStartedAt"
    | "notes",
  formData: FormData,
): Promise<BuildFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { message: "Missing build id" };
  }
  const raw = pickString(formData, fieldName);
  // Empty string → null sentinel matches the action layer's "clear" semantics.
  const value = raw === undefined ? "" : raw;
  try {
    await editBuild({ id, [fieldName]: value });
    return {};
  } catch (err) {
    if (err instanceof ZodError) {
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

export async function editBuildPcbOrderRefAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("pcbOrderRef", formData);
}

export async function editBuildPartsOrderRefAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("partsOrderRef", formData);
}

export async function editBuildOrderedAtAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("orderedAt", formData);
}

export async function editBuildReceivedAtAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("receivedAt", formData);
}

export async function editBuildAssemblyStartedAtAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("assemblyStartedAt", formData);
}

export async function editBuildNotesAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  return editBuildSingleField("notes", formData);
}
