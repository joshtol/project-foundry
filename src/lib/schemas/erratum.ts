// Zod 4 schemas + shared constants for Erratum CRUD (design §4.2, §5.3
// post-freeze write path).
//
// Errata are the ONE write path that survives the revision freeze: per design
// §5.3, "Erratum CRUD bypasses all three" assertion helpers (assertNotFrozen,
// assertBomNotFrozen, assertBuildNotFrozen). Stage 9 (REVISION) is the
// terminal stage and the place defects get captured against the now-frozen
// rev. This file defines the validation surface; the action layer
// deliberately omits the freeze guards.
//
// `addressedByRevisionId` carries the forward link to the next rev that fixes
// the defect. Same-project constraint is enforced server-side in the action
// (no DB CHECK — design §12.1 trapdoor list explicitly trades this off).
import { z } from "zod";
import { ErratumSeverity, ErratumStatus } from "@prisma/client";

// Canonical rejection message for cross-project address-by link attempts.
// Lives here (non-"use server" module) so client code + tests can import
// the literal string without triggering Next's server-action export-shape
// check (which rejects non-async const exports from "use server" files).
export const CROSS_PROJECT_ERRATUM_MSG =
  "Errata can only address revisions within the same project.";

export const createErratumSchema = z.object({
  revisionId: z.cuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1),
  severity: z.enum(ErratumSeverity),
  status: z.enum(ErratumStatus).default("OPEN"),
  addressedByRevisionId: z.cuid().optional(),
});

export type CreateErratumInput = z.infer<typeof createErratumSchema>;

// Edit allows partial mutation of every editable field. `revisionId` is NOT
// editable post-create — the row is tied to the revision it was captured
// against, and re-homing it would invalidate the same-project link semantics
// without any audit trail.
export const editErratumSchema = z.object({
  id: z.cuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).optional(),
  severity: z.enum(ErratumSeverity).optional(),
  status: z.enum(ErratumStatus).optional(),
  addressedByRevisionId: z.cuid().nullable().optional(),
});

export type EditErratumInput = z.infer<typeof editErratumSchema>;

// Dedicated link action — separates the "address this erratum with that rev"
// flow from generic edit so the same-project check has a single, obvious
// call site.
export const linkErratumSchema = z.object({
  id: z.cuid(),
  addressedByRevisionId: z.cuid(),
});

export type LinkErratumInput = z.infer<typeof linkErratumSchema>;

export const deleteErratumSchema = z.object({
  id: z.cuid(),
});

export type DeleteErratumInput = z.infer<typeof deleteErratumSchema>;
