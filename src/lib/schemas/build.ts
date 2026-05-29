// Zod 4 schemas for Build CRUD.
//
// `label` is case-preserving (e.g. `BUILD-001`); the functional unique
// index `build_revision_label_ci` enforces case-insensitive uniqueness at
// the DB layer. boardCount is bounded by sanity, not by the schema. We pick
// 1..100 as Phase 1 guard rails — five-board builds are the norm, anything
// past a hundred is almost certainly a typo.
import { z } from "zod";

export const createBuildSchema = z.object({
  revisionId: z.cuid(),
  label: z.string().trim().min(1).max(32),
  boardCount: z.coerce.number().int().min(1).max(100),
});

export type CreateBuildInput = z.infer<typeof createBuildSchema>;

// editBuildSchema accepts each Build-header field optional; the action layer
// drops undefined keys so unspecified fields are left alone. Dates accept ISO
// strings (form payload) and Date instances (programmatic callers). Empty
// string on a date or text field means "clear" — converted to null in the
// action.
const optionalDate = z
  .union([
    z.iso.datetime(),
    z.iso.date(),
    z.date(),
    z.literal(""),
    z.null(),
  ])
  .optional();

export const editBuildSchema = z.object({
  id: z.cuid(),
  pcbOrderRef: z.union([z.string().max(120), z.null()]).optional(),
  partsOrderRef: z.union([z.string().max(120), z.null()]).optional(),
  orderedAt: optionalDate,
  receivedAt: optionalDate,
  assemblyStartedAt: optionalDate,
  notes: z.union([z.string().max(4000), z.null()]).optional(),
});

export type EditBuildInput = z.infer<typeof editBuildSchema>;
