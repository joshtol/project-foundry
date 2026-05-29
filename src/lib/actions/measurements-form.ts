"use server";

// useActionState-compatible form-action wrappers for Measurement CRUD
// (Task 14.2). Mirrors the checklists-form / errata-form patterns.
//
// `createMeasurementFormAction` powers the single-row "Add measurement"
// form. `addMeasurementsBulkFormAction` powers the bulk paste-tabbed flow:
// the textarea field "bulkText" is parsed line-by-line, columns
// tab-separated, into the canonical row shape. Header row is detected by
// looking at the first row's `actualValue` slot — if it's literally
// "actualValue" or "actual" we drop it.
//
// Column layout (matches the on-screen preview):
//   stage \t step \t expected \t actual \t unit \t result
//
// `expected`, `unit`, `result` are optional. Empty columns parse as
// missing (undefined). `result` falls back to PEND via the schema default
// when missing.
import { ZodError } from "zod";
import { MeasurementResult, Stage } from "@prisma/client";
import {
  addMeasurementsBulk,
  createMeasurement,
  deleteMeasurement,
  editMeasurement,
} from "@/lib/actions/measurements";

export type MeasurementFormState = {
  errors?: Record<string, string[]>;
  message?: string;
  ok?: boolean;
  insertedCount?: number;
};

function pickString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

function pickRaw(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  return v;
}

function zodErrors(err: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_root";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

export async function createMeasurementFormAction(
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const boardId = pickString(formData, "boardId");
  const stageRaw = pickString(formData, "stage");
  const step = pickString(formData, "step");
  const expectedValue = pickString(formData, "expectedValue");
  const actualValue = pickString(formData, "actualValue");
  const unit = pickString(formData, "unit");
  const resultRaw = pickString(formData, "result");
  const notes = pickString(formData, "notes");

  if (!boardId) return { message: "Missing board id." };
  if (!stageRaw || !(stageRaw in Stage)) return { message: "Invalid stage." };
  if (resultRaw && !(resultRaw in MeasurementResult)) {
    return { message: "Invalid result." };
  }

  try {
    await createMeasurement({
      boardId,
      stage: stageRaw as Stage,
      step,
      expectedValue,
      actualValue,
      unit,
      result: resultRaw,
      notes,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ZodError) return { errors: zodErrors(err) };
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function editMeasurementFormAction(
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const id = pickString(formData, "id");
  if (!id) return { message: "Missing measurement id." };
  const stageRaw = pickString(formData, "stage");
  const step = pickString(formData, "step");
  const expectedValue = pickString(formData, "expectedValue");
  const actualValue = pickString(formData, "actualValue");
  const unit = pickString(formData, "unit");
  const resultRaw = pickString(formData, "result");
  const notes = pickString(formData, "notes");

  if (stageRaw && !(stageRaw in Stage)) return { message: "Invalid stage." };
  if (resultRaw && !(resultRaw in MeasurementResult)) {
    return { message: "Invalid result." };
  }

  try {
    await editMeasurement({
      id,
      stage: stageRaw as Stage | undefined,
      step,
      expectedValue,
      actualValue,
      unit,
      result: resultRaw,
      notes,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ZodError) return { errors: zodErrors(err) };
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function deleteMeasurementFormAction(
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const id = pickString(formData, "id");
  if (!id) return { message: "Missing measurement id." };
  try {
    await deleteMeasurement({ id });
    return { ok: true };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Bulk-paste parsing. Expected layout (header optional):
//   stage \t step \t expected \t actual \t unit \t result
// Empty cells map to `undefined` (the schema falls back / nulls accordingly).
function parseBulkRows(text: string): Array<Record<string, string | undefined>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Detect & drop a header line. We look at the first line's tokens for
  // the literal words "stage" + "step" — case-insensitive — so a user's
  // paste from a spreadsheet with headers works.
  const firstTokens = lines[0]!.split("\t").map((c) => c.trim().toLowerCase());
  const dataLines =
    firstTokens.includes("stage") && firstTokens.includes("step")
      ? lines.slice(1)
      : lines;

  return dataLines.map((line) => {
    const cols = line.split("\t").map((c) => c.trim());
    const [stage, step, expectedValue, actualValue, unit, result] = cols;
    return {
      stage: stage || undefined,
      step: step || undefined,
      expectedValue: expectedValue || undefined,
      actualValue: actualValue || undefined,
      unit: unit || undefined,
      result: result || undefined,
    };
  });
}

export async function addMeasurementsBulkFormAction(
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const boardId = pickString(formData, "boardId");
  const bulkText = pickRaw(formData, "bulkText") ?? "";
  if (!boardId) return { message: "Missing board id." };

  const parsed = parseBulkRows(bulkText);
  if (parsed.length === 0) {
    return { message: "No rows parsed from input." };
  }

  // Validate enum-typed columns up-front so a typo doesn't trip the full
  // Zod validation a row later.
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i]!;
    if (!r.stage) return { message: `Row ${i + 1}: missing stage.` };
    if (!(r.stage in Stage)) {
      return { message: `Row ${i + 1}: invalid stage "${r.stage}".` };
    }
    if (r.result && !(r.result in MeasurementResult)) {
      return { message: `Row ${i + 1}: invalid result "${r.result}".` };
    }
  }

  try {
    const result = await addMeasurementsBulk({
      boardId,
      rows: parsed.map((r) => ({
        stage: r.stage as Stage,
        step: r.step,
        expectedValue: r.expectedValue,
        actualValue: r.actualValue,
        unit: r.unit,
        result: r.result as MeasurementResult | undefined,
      })),
    });
    return { ok: true, insertedCount: result.count };
  } catch (err) {
    if (err instanceof ZodError) return { errors: zodErrors(err) };
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}
