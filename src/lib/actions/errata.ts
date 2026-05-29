"use server";

// Erratum server actions (design §5.3 post-freeze write path, §9.1 errata pane).
//
// THIS IS THE POST-FREEZE WRITE PATH. Per design §5.3:
//   "Erratum CRUD bypasses all three [assertNotFrozen / assertBomNotFrozen /
//   assertBuildNotFrozen] — stage 9 is the post-freeze write path."
//
// That means: no assertion-helper wrappers in this file. A revision that has
// hit REVISION (frozen) still accepts erratum create/edit/delete — that's the
// whole point of the stage. Verified by `createErratum-on-frozen-revision`
// test in the accompanying test file.
//
// Same-project constraint on `addressedByRevisionId` is enforced server-side
// only — design §12.1 explicitly trades off a DB CHECK for this since errata
// addressing is a workflow concern, not a structural invariant.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { withTxRetry } from "@/lib/tx-retry";
import {
  createErratumSchema,
  CROSS_PROJECT_ERRATUM_MSG,
  deleteErratumSchema,
  editErratumSchema,
  linkErratumSchema,
} from "@/lib/schemas/erratum";

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

export async function createErratum(input: unknown) {
  const data = createErratumSchema.parse(input);
  const user = await requireUser();

  const created = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        // Verify the source revision exists. We deliberately DO NOT call
        // assertNotFrozen — errata are the post-freeze write path (design §5.3).
        const sourceRev = await tx.revision.findUniqueOrThrow({
          where: { id: data.revisionId },
          select: { id: true, projectId: true },
        });

        // If addressedByRevisionId is supplied at create time, enforce the
        // same-project constraint. (Mirrors linkErratumToRevision.)
        if (data.addressedByRevisionId) {
          const target = await tx.revision.findUniqueOrThrow({
            where: { id: data.addressedByRevisionId },
            select: { projectId: true },
          });
          if (target.projectId !== sourceRev.projectId) {
            throw new Error(CROSS_PROJECT_ERRATUM_MSG);
          }
        }

        return tx.erratum.create({
          data: {
            revisionId: sourceRev.id,
            title: data.title,
            description: data.description,
            severity: data.severity,
            status: data.status,
            addressedByRevisionId: data.addressedByRevisionId ?? null,
            createdById: user.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadRevisionRoute(db, created.revisionId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
  );

  return created;
}

export async function editErratum(input: unknown) {
  const data = editErratumSchema.parse(input);
  await requireUser();

  const updated = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.erratum.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, revisionId: true },
        });

        // Same-project guard at edit time too — keeps the invariant honest
        // whether the link is set at create or via edit (or unset back to null).
        if (data.addressedByRevisionId !== undefined && data.addressedByRevisionId !== null) {
          const [sourceRev, targetRev] = await Promise.all([
            tx.revision.findUniqueOrThrow({
              where: { id: existing.revisionId },
              select: { projectId: true },
            }),
            tx.revision.findUniqueOrThrow({
              where: { id: data.addressedByRevisionId },
              select: { projectId: true },
            }),
          ]);
          if (sourceRev.projectId !== targetRev.projectId) {
            throw new Error(CROSS_PROJECT_ERRATUM_MSG);
          }
        }

        const patch: Prisma.ErratumUpdateInput = {};
        if (data.title !== undefined) patch.title = data.title;
        if (data.description !== undefined) patch.description = data.description;
        if (data.severity !== undefined) patch.severity = data.severity;
        if (data.status !== undefined) patch.status = data.status;
        if (data.addressedByRevisionId !== undefined) {
          // null clears the link; cuid sets it. Prisma update needs the
          // relation-disconnect form for unset, but the FK can be written
          // directly via uncheckedUpdate semantics by going through
          // the connect/disconnect API. Simpler: use the foreign-key field
          // via Prisma's relation-by-id pattern.
          if (data.addressedByRevisionId === null) {
            patch.addressedBy = { disconnect: true };
          } else {
            patch.addressedBy = {
              connect: { id: data.addressedByRevisionId },
            };
          }
        }

        return tx.erratum.update({
          where: { id: data.id },
          data: patch,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadRevisionRoute(db, updated.revisionId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
  );

  return updated;
}

export async function linkErratumToRevision(input: unknown) {
  const data = linkErratumSchema.parse(input);
  await requireUser();

  const updated = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.erratum.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, revisionId: true },
        });
        const [sourceRev, targetRev] = await Promise.all([
          tx.revision.findUniqueOrThrow({
            where: { id: existing.revisionId },
            select: { projectId: true },
          }),
          tx.revision.findUniqueOrThrow({
            where: { id: data.addressedByRevisionId },
            select: { projectId: true },
          }),
        ]);
        if (sourceRev.projectId !== targetRev.projectId) {
          throw new Error(CROSS_PROJECT_ERRATUM_MSG);
        }

        return tx.erratum.update({
          where: { id: data.id },
          data: {
            addressedBy: { connect: { id: data.addressedByRevisionId } },
            // When linking to a fix-rev, the conventional next status is
            // FIXED_NEXT_REV. Only auto-set if currently OPEN — don't trample
            // an explicit WONT_FIX.
            status:
              undefined, // status flip is left to the editor; this action focuses on the link
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadRevisionRoute(db, updated.revisionId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
  );

  return updated;
}

export async function deleteErratum(input: unknown) {
  const data = deleteErratumSchema.parse(input);
  await requireUser();

  const { revisionId } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.erratum.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, revisionId: true },
        });
        await tx.erratum.delete({ where: { id: data.id } });
        return { revisionId: existing.revisionId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadRevisionRoute(db, revisionId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(route.revLabel)}`,
  );

  return { ok: true as const };
}
