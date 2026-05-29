// Zod 4 schemas for Measurement CRUD (design §4.2, §8.3, §9.3).
//
// Phase 14 / M9c scope: per-Board measurement log with grouped (stage,
// step) rendering. Per design §8.3 the `result` field drives pill color:
//   PASS → status-green, FAIL → alert-red, OBSERVED/PEND → muted.
//
// `result` defaults to PEND so a bulk paste with no explicit result column
// captures readings as "not yet adjudicated" rather than silently passing.
// The action layer + log UI both honor this default.
//
// Bulk-add carries a flat list of rows under a single `boardId`; the
// action wraps them in one Serializable tx so partial commits don't
// happen on Zod failure or freeze-guard rejection.
import { z } from "zod";
import { MeasurementResult, Stage } from "@prisma/client";

const stageEnum = z.enum(Stage);
const resultEnum = z.enum(MeasurementResult);

const measurementFields = {
  stage: stageEnum,
  step: z.string().trim().min(1).max(200),
  expectedValue: z.string().trim().max(200).optional(),
  actualValue: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(50).optional(),
  result: resultEnum.default("PEND"),
  notes: z.string().trim().max(2000).optional(),
};

export const createMeasurementSchema = z.object({
  boardId: z.cuid(),
  ...measurementFields,
});

export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;

// Edit: every field optional. Board / stage / step / actualValue are
// individually editable since a tech might correct a mis-typed reading
// after capture. The action drops `undefined` keys so unspecified fields
// are left alone.
export const editMeasurementSchema = z.object({
  id: z.cuid(),
  stage: stageEnum.optional(),
  step: z.string().trim().min(1).max(200).optional(),
  expectedValue: z.union([z.string().max(200), z.null()]).optional(),
  actualValue: z.string().trim().min(1).max(200).optional(),
  unit: z.union([z.string().max(50), z.null()]).optional(),
  result: resultEnum.optional(),
  notes: z.union([z.string().max(2000), z.null()]).optional(),
});

export type EditMeasurementInput = z.infer<typeof editMeasurementSchema>;

export const deleteMeasurementSchema = z.object({
  id: z.cuid(),
});

export type DeleteMeasurementInput = z.infer<typeof deleteMeasurementSchema>;

// Bulk add — rows reuse the per-row field set (without boardId, which is
// hoisted to the envelope). Each row carries a default `result = PEND`.
const bulkRowSchema = z.object(measurementFields);

export const addMeasurementsBulkSchema = z.object({
  boardId: z.cuid(),
  rows: z.array(bulkRowSchema).min(1).max(500),
});

export type AddMeasurementsBulkInput = z.infer<
  typeof addMeasurementsBulkSchema
>;
