"use server";

// Measurement server actions (design §4.2, §9.3).
//
// Phase 14 / M9c scope: single + bulk per-Board CRUD. Measurements live
// under a Board, which lives under a Build, which lives under a Revision.
// Freeze policy mirrors the boards.ts pattern: every mutation wraps both
// `assertNotFrozen(revisionId)` (resolved via board.build.revisionId) and
// `assertBuildNotFrozen(buildId)` (resolved via board.buildId).
//
// `addMeasurementsBulk` runs as a single Serializable tx — Zod has already
// validated the entire row set up-front, but if a row's actualValue triggers
// a DB-level constraint mid-insert (or freeze flips mid-tx), the whole
// batch rolls back.
//
// `measuredById` is stamped from the current user; `measuredAt` defaults
// to NOW() via the schema. We don't expose either as user-editable since
// they're audit columns.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { assertBuildNotFrozen, assertNotFrozen } from "@/lib/assertions";
import { withTxRetry } from "@/lib/tx-retry";
import {
  addMeasurementsBulkSchema,
  createMeasurementSchema,
  deleteMeasurementSchema,
  editMeasurementSchema,
} from "@/lib/schemas/measurement";

async function loadBoardRoute(boardId: string) {
  const board = await db.board.findUniqueOrThrow({
    where: { id: boardId },
    select: {
      serial: true,
      build: {
        select: {
          label: true,
          revision: {
            select: {
              label: true,
              project: { select: { slug: true } },
            },
          },
        },
      },
    },
  });
  return {
    projectSlug: board.build.revision.project.slug,
    revLabel: board.build.revision.label,
    buildLabel: board.build.label,
    serial: board.serial,
  };
}

// Resolve the freeze refs for a Measurement row given a boardId. Loaded
// inside the tx so a concurrent freeze sees the cascade.
async function resolveBoardFreezeRefs(
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<{ revisionId: string; buildId: string }> {
  const board = await tx.board.findUniqueOrThrow({
    where: { id: boardId },
    select: {
      buildId: true,
      build: { select: { revisionId: true } },
    },
  });
  return { revisionId: board.build.revisionId, buildId: board.buildId };
}

// ─── createMeasurement ─────────────────────────────────

export async function createMeasurement(input: unknown) {
  const data = createMeasurementSchema.parse(input);
  const user = await requireUser();

  const measurement = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const refs = await resolveBoardFreezeRefs(tx, data.boardId);
        await assertNotFrozen(tx, refs.revisionId);
        await assertBuildNotFrozen(tx, refs.buildId);

        return tx.measurement.create({
          data: {
            boardId: data.boardId,
            stage: data.stage,
            step: data.step,
            expectedValue: data.expectedValue ?? null,
            actualValue: data.actualValue,
            unit: data.unit ?? null,
            result: data.result,
            notes: data.notes ?? null,
            measuredById: user.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadBoardRoute(data.boardId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(
      route.revLabel,
    )}/builds/${encodeURIComponent(route.buildLabel)}/boards/${encodeURIComponent(route.serial)}`,
  );
  return measurement;
}

// ─── addMeasurementsBulk ───────────────────────────────

export async function addMeasurementsBulk(input: unknown) {
  const data = addMeasurementsBulkSchema.parse(input);
  const user = await requireUser();

  const inserted = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const refs = await resolveBoardFreezeRefs(tx, data.boardId);
        await assertNotFrozen(tx, refs.revisionId);
        await assertBuildNotFrozen(tx, refs.buildId);

        // Use createMany so the entire row set lands in one round-trip.
        // We don't need the inserted rows back (the page revalidation
        // picks them up), so `skipDuplicates` is irrelevant; we return
        // the count instead.
        const result = await tx.measurement.createMany({
          data: data.rows.map((r) => ({
            boardId: data.boardId,
            stage: r.stage,
            step: r.step,
            expectedValue: r.expectedValue ?? null,
            actualValue: r.actualValue,
            unit: r.unit ?? null,
            result: r.result,
            notes: r.notes ?? null,
            measuredById: user.id,
          })),
        });

        return result.count;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadBoardRoute(data.boardId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(
      route.revLabel,
    )}/builds/${encodeURIComponent(route.buildLabel)}/boards/${encodeURIComponent(route.serial)}`,
  );
  return { count: inserted };
}

// ─── editMeasurement ───────────────────────────────────

export async function editMeasurement(input: unknown) {
  const data = editMeasurementSchema.parse(input);
  await requireUser();

  const updated = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.measurement.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, boardId: true },
        });
        const refs = await resolveBoardFreezeRefs(tx, existing.boardId);
        await assertNotFrozen(tx, refs.revisionId);
        await assertBuildNotFrozen(tx, refs.buildId);

        const patch: Prisma.MeasurementUpdateInput = {};
        if (data.stage !== undefined) patch.stage = data.stage;
        if (data.step !== undefined) patch.step = data.step;
        if (data.expectedValue !== undefined) {
          patch.expectedValue =
            data.expectedValue === null || data.expectedValue === ""
              ? null
              : data.expectedValue;
        }
        if (data.actualValue !== undefined) patch.actualValue = data.actualValue;
        if (data.unit !== undefined) {
          patch.unit =
            data.unit === null || data.unit === "" ? null : data.unit;
        }
        if (data.result !== undefined) patch.result = data.result;
        if (data.notes !== undefined) {
          patch.notes =
            data.notes === null || data.notes === "" ? null : data.notes;
        }

        return tx.measurement.update({
          where: { id: data.id },
          data: patch,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadBoardRoute(updated.boardId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(
      route.revLabel,
    )}/builds/${encodeURIComponent(route.buildLabel)}/boards/${encodeURIComponent(route.serial)}`,
  );
  return updated;
}

// ─── deleteMeasurement ─────────────────────────────────

export async function deleteMeasurement(input: unknown) {
  const data = deleteMeasurementSchema.parse(input);
  await requireUser();

  const { boardId } = await withTxRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.measurement.findUniqueOrThrow({
          where: { id: data.id },
          select: { id: true, boardId: true },
        });
        const refs = await resolveBoardFreezeRefs(tx, existing.boardId);
        await assertNotFrozen(tx, refs.revisionId);
        await assertBuildNotFrozen(tx, refs.buildId);
        await tx.measurement.delete({ where: { id: data.id } });
        return { boardId: existing.boardId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  const route = await loadBoardRoute(boardId);
  revalidatePath(
    `/projects/${route.projectSlug}/${encodeURIComponent(
      route.revLabel,
    )}/builds/${encodeURIComponent(route.buildLabel)}/boards/${encodeURIComponent(route.serial)}`,
  );
  return { ok: true as const };
}
