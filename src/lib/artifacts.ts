// Artifact ownership mapping (design §4.3, §7).
//
// `ARTIFACT_SUBKIND_OWNER` is the single source of truth for which side of
// the Artifact owner XOR a given subkind binds to. Used by:
//   - createArtifact server action (Task 9.2) to cross-check the requested
//     owner against the subkind before any DB insert.
//   - createUploadUrl + recordArtifact (Phase 10) as the same cross-check
//     at both presign time and record time (defense-in-depth against forged
//     tokens — design §7 steps 2 and 8).
//
// GENERIC is `"either"` because it's owner-agnostic (notes / links / generic
// files on either side). Every typed subkind binds to exactly one owner; the
// migration-level `artifact_owner_xor` CHECK then enforces "exactly one of
// (revisionId, buildId) is non-null" regardless of subkind.

import type { ArtifactSubkind } from "@prisma/client";

export type ArtifactOwnerKind = "revision" | "build" | "either";

export const ARTIFACT_SUBKIND_OWNER: Readonly<
  Record<ArtifactSubkind, ArtifactOwnerKind>
> = {
  GENERIC: "either",
  REQUIREMENTS_DOC: "revision",
  SCHEMATIC_FILE: "revision",
  BOM_EXPORT: "revision",
  LAYOUT_FILE: "revision",
  DRC_REPORT: "revision",
  GERBER_ZIP: "revision",
  ASSEMBLY_PROCEDURE: "revision",
  BENCH_PROCEDURE: "revision",
  PCB_ORDER: "build",
  PARTS_ORDER: "build",
  BRINGUP_LOG: "build",
  BRINGUP_COMPLETE: "build",
};

/**
 * Returns true when `subkind` is allowed on the given `ownerKind`. GENERIC
 * matches both; typed subkinds match their declared owner only.
 */
export function ownerMatches(
  subkind: ArtifactSubkind,
  ownerKind: "revision" | "build",
): boolean {
  const expected = ARTIFACT_SUBKIND_OWNER[subkind];
  return expected === "either" || expected === ownerKind;
}
