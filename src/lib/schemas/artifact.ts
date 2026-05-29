// Zod 4 schemas for Artifact CRUD (design §4.3 + §7).
//
// Phase 9 / M8a scope: NOTE + LINK only. FILE-kind artifacts ship in Phase 10
// (M8b) once R2 is wired. The `kind` discriminator switches the payload:
//   - NOTE: `noteBody` markdown string (server-sanitized in the action).
//   - LINK: `linkUrl` URL string.
//
// Owner is `{ kind: "revision" | "build", id: cuid }` — the action cross-checks
// `ownerMatches(subkind, owner.kind)` before any DB work per design §7 step 2.
// `stage` is the Stage enum value the artifact attaches to.
import { z } from "zod";
import { ArtifactSubkind, Stage } from "@prisma/client";

const ownerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revision"), id: z.cuid() }),
  z.object({ kind: z.literal("build"), id: z.cuid() }),
]);

const baseCreateFields = {
  owner: ownerSchema,
  stage: z.enum(Stage),
  subkind: z.enum(ArtifactSubkind),
  title: z.string().trim().min(1).max(200),
};

// `discriminatedUnion` on `kind` lets the action layer narrow on the payload
// without a separate type-guard. Server cross-checks subkind ↔ owner; the DB
// CHECK constraints enforce the owner XOR + payload XOR at the row level.
export const createArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseCreateFields,
    kind: z.literal("NOTE"),
    noteBody: z.string().min(1).max(50_000),
  }),
  z.object({
    ...baseCreateFields,
    kind: z.literal("LINK"),
    linkUrl: z.url().max(2048),
  }),
]);

export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;

// Edits don't allow changing owner/stage/subkind/kind post-create — that would
// blow the XOR + indexing assumptions. Only the human-editable surface is
// reachable: title + payload for the kind that already exists. The action
// resolves which payload field to update by re-reading the row's kind.
export const editArtifactSchema = z.object({
  id: z.cuid(),
  title: z.string().trim().min(1).max(200).optional(),
  noteBody: z.string().min(1).max(50_000).optional(),
  linkUrl: z.url().max(2048).optional(),
});

export type EditArtifactInput = z.infer<typeof editArtifactSchema>;

export const deleteArtifactSchema = z.object({
  id: z.cuid(),
});

export type DeleteArtifactInput = z.infer<typeof deleteArtifactSchema>;
