"use server";

// Artifact server actions (design §4.3, §7, §9.1, §9.2).
//
// Phase 9 / M8a scope: NOTE + LINK only. FILE-kind ships in Phase 10 with
// the R2 presigned-PUT + recordArtifact flow. The picker UI (Task 9.3)
// surfaces only NOTE and LINK at the radio level, and the server enforces
// the same restriction here.
//
// Three invariants enforced on createArtifact before any insert:
//   1. Owner cross-check: `ownerMatches(subkind, owner.kind)` per design §7
//      step 2 / §4.3 mapping. GENERIC accepts both; typed subkinds bind to
//      one side. The DB `artifact_owner_xor` CHECK enforces "exactly one of
//      (revisionId, buildId) is non-null" — this action check is the
//      friendly-error path before the constraint trips.
//   2. Stage-allowed cross-check: the subkind must be allowed for the
//      revision/build pane at the current stage. We read from
//      STAGES[stage].(revisionAllowedArtifactSubkinds | buildAllowedArtifactSubkinds)
//      per the picker's own filter. `BRINGUP_COMPLETE` is intentionally
//      absent from buildAllowedArtifactSubkinds — that subkind is created
//      ONLY via the "Mark bring-up complete" action (Task 9.4), so any
//      attempt to create one through this action surfaces as a stage-not-
//      allowed rejection.
//   3. Freeze policy: `assertNotFrozen` on the revision the artifact belongs
//      to (directly via owner.kind === "revision", or transitively through
//      the build's parent revision). For build-scoped artifacts, also
//      `assertBuildNotFrozen` so a frozen Build can't accept new artifacts
//      even when the revision is still open.
//
// Edit / delete reuse the same freeze guards. Note bodies are sanitized
// with `sanitize-html` (markdown source) at write time — see `sanitizeNote`
// below for the strict allow-list.

import { ArtifactKind, ArtifactSubkind, Prisma, Stage } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { assertBuildNotFrozen, assertNotFrozen } from "@/lib/assertions";
import { ownerMatches } from "@/lib/artifacts";
import { STAGES } from "@/lib/stages";
import { withTxRetry } from "@/lib/tx-retry";
import {
  createArtifactSchema,
  deleteArtifactSchema,
  editArtifactSchema,
} from "@/lib/schemas/artifact";

// Strict HTML allow-list: markdown source flows through this before insert.
// Markdown permits raw HTML; this strips every tag (the result is plain text
// or pure markdown) so a renderer can re-render safely. We deliberately keep
// the list empty rather than allowing "safe" HTML — the storage format is
// markdown, not HTML. Renderers (Phase 10+) parse markdown to HTML in a
// separate pass with their own sanitization.
function sanitizeNote(body: string): string {
  return sanitizeHtml(body, {
    allowedTags: [],
    allowedAttributes: {},
    // Drop tag contents for script/style so e.g. "<script>alert(1)</script>"
    // doesn't leak the text "alert(1)" into the markdown.
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
}

async function loadRevisionRoute(
  tx: Prisma.TransactionClient,
  revisionId: string,
) {
  const rev = await tx.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      label: true,
      project: { select: { slug: true } },
    },
  });
  return { projectSlug: rev.project.slug, revLabel: rev.label };
}

async function loadBuildRoute(
  tx: Prisma.TransactionClient,
  buildId: string,
) {
  const build = await tx.build.findUniqueOrThrow({
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

export async function createArtifact(input: unknown) {
  const data = createArtifactSchema.parse(input);
  const user = await requireUser();

  // Cross-check #1: subkind ↔ owner-kind. Run before any DB call so a forged
  // payload gets the cheapest possible rejection (also keeps the DB-tx
  // window narrow).
  if (!ownerMatches(data.subkind, data.owner.kind)) {
    throw new Error(
      `Subkind ${data.subkind} is not valid for ${data.owner.kind}-owned artifacts.`,
    );
  }

  // Cross-check #2: stage allows this subkind for this owner kind. We read
  // directly from STAGES so the picker UI and the server-side rule share
  // the same source of truth.
  const allowed =
    data.owner.kind === "revision"
      ? STAGES[data.stage].revisionAllowedArtifactSubkinds
      : STAGES[data.stage].buildAllowedArtifactSubkinds;
  if (!allowed.includes(data.subkind)) {
    throw new Error(
      `Subkind ${data.subkind} is not allowed at stage ${data.stage} for ${data.owner.kind}-owned artifacts.`,
    );
  }

  const artifact = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        // Freeze guards. For build-scoped artifacts we also assert the
        // parent revision isn't frozen — symmetric with editBuild and the
        // §5.3 helper table.
        if (data.owner.kind === "revision") {
          await assertNotFrozen(tx, data.owner.id);
        } else {
          const build = await tx.build.findUniqueOrThrow({
            where: { id: data.owner.id },
            select: { revisionId: true },
          });
          await assertNotFrozen(tx, build.revisionId);
          await assertBuildNotFrozen(tx, data.owner.id);
        }

        const insertData: Prisma.ArtifactUncheckedCreateInput = {
          revisionId: data.owner.kind === "revision" ? data.owner.id : null,
          buildId: data.owner.kind === "build" ? data.owner.id : null,
          stage: data.stage,
          kind: data.kind,
          subkind: data.subkind,
          title: data.title,
          createdBy: user.id,
        };

        if (data.kind === "NOTE") {
          insertData.noteBody = sanitizeNote(data.noteBody);
        } else if (data.kind === "LINK") {
          insertData.linkUrl = data.linkUrl;
        }

        return tx.artifact.create({ data: insertData });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  // Revalidate the owning detail page so the new row shows up on next nav.
  if (artifact.revisionId) {
    const route = await loadRevisionRoute(db, artifact.revisionId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
    );
  } else if (artifact.buildId) {
    const route = await loadBuildRoute(db, artifact.buildId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}/builds/${encodeURIComponent(route.buildLabel)}`,
    );
  }

  return artifact;
}

export async function editArtifact(input: unknown) {
  const data = editArtifactSchema.parse(input);
  await requireUser();

  const updated = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.artifact.findUniqueOrThrow({
          where: { id: data.id },
          select: {
            id: true,
            kind: true,
            revisionId: true,
            buildId: true,
          },
        });

        // Freeze guards (both sides). For build-scoped, also assert parent
        // revision so a freeze cascade is honored.
        if (existing.revisionId) {
          await assertNotFrozen(tx, existing.revisionId);
        } else if (existing.buildId) {
          const build = await tx.build.findUniqueOrThrow({
            where: { id: existing.buildId },
            select: { revisionId: true },
          });
          await assertNotFrozen(tx, build.revisionId);
          await assertBuildNotFrozen(tx, existing.buildId);
        }

        const patch: Prisma.ArtifactUpdateInput = {};
        if (data.title !== undefined) patch.title = data.title;

        // Only allow editing the payload field matching the row's kind.
        // Cross-kind edits are silently ignored — the schema's optional
        // fields make this caller-friendly; the per-kind check makes it safe.
        if (existing.kind === "NOTE" && data.noteBody !== undefined) {
          patch.noteBody = sanitizeNote(data.noteBody);
        }
        if (existing.kind === "LINK" && data.linkUrl !== undefined) {
          patch.linkUrl = data.linkUrl;
        }

        return tx.artifact.update({
          where: { id: data.id },
          data: patch,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  if (updated.revisionId) {
    const route = await loadRevisionRoute(db, updated.revisionId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
    );
  } else if (updated.buildId) {
    const route = await loadBuildRoute(db, updated.buildId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}/builds/${encodeURIComponent(route.buildLabel)}`,
    );
  }

  return updated;
}

export async function deleteArtifact(input: unknown) {
  const data = deleteArtifactSchema.parse(input);
  await requireUser();

  const { revisionId, buildId } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.artifact.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, revisionId: true, buildId: true },
        });

        if (existing.revisionId) {
          await assertNotFrozen(tx, existing.revisionId);
        } else if (existing.buildId) {
          const build = await tx.build.findUniqueOrThrow({
            where: { id: existing.buildId },
            select: { revisionId: true },
          });
          await assertNotFrozen(tx, build.revisionId);
          await assertBuildNotFrozen(tx, existing.buildId);
        }

        await tx.artifact.delete({ where: { id: data.id } });
        return {
          revisionId: existing.revisionId,
          buildId: existing.buildId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  if (revisionId) {
    const route = await loadRevisionRoute(db, revisionId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
    );
  } else if (buildId) {
    const route = await loadBuildRoute(db, buildId);
    revalidatePath(
      `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}/builds/${encodeURIComponent(route.buildLabel)}`,
    );
  }

  return { ok: true as const };
}

// ─── Form action wrappers (useActionState-compatible) ──────────────────

export type ArtifactFormState = {
  errors?: Record<string, string[]>;
  message?: string;
  createdId?: string;
};

function pickString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  return v;
}

export async function createArtifactFormAction(
  _prev: ArtifactFormState,
  formData: FormData,
): Promise<ArtifactFormState> {
  const ownerKindRaw = pickString(formData, "ownerKind");
  const ownerId = pickString(formData, "ownerId");
  const stageRaw = pickString(formData, "stage");
  const subkindRaw = pickString(formData, "subkind");
  const kindRaw = pickString(formData, "kind");
  const title = pickString(formData, "title") ?? "";

  if (
    ownerKindRaw !== "revision" &&
    ownerKindRaw !== "build"
  ) {
    return { message: "Invalid owner kind." };
  }
  if (!ownerId) return { message: "Missing owner id." };
  if (!stageRaw || !(stageRaw in Stage)) {
    return { message: "Invalid stage." };
  }
  if (!subkindRaw || !(subkindRaw in ArtifactSubkind)) {
    return { message: "Invalid subkind." };
  }
  if (kindRaw !== "NOTE" && kindRaw !== "LINK") {
    return { message: "Invalid artifact kind." };
  }

  const base = {
    owner: { kind: ownerKindRaw, id: ownerId },
    stage: stageRaw as Stage,
    subkind: subkindRaw as ArtifactSubkind,
    title: title.trim(),
  };

  const payload =
    kindRaw === "NOTE"
      ? {
          ...base,
          kind: "NOTE" as const satisfies ArtifactKind,
          noteBody: pickString(formData, "noteBody") ?? "",
        }
      : {
          ...base,
          kind: "LINK" as const satisfies ArtifactKind,
          linkUrl: pickString(formData, "linkUrl") ?? "",
        };

  try {
    const artifact = await createArtifact(payload);
    return { createdId: artifact.id };
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
