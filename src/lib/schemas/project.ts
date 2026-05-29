// Zod 4 schemas for Project CRUD. The slug regex matches the only safe shape
// for URL path segments (lowercase alphanumeric + hyphen); we mirror that as
// the DB invariant via @unique on Project.slug.
//
// `editProjectSchema` requires `id` (cuid) and makes every editable field
// optional — the action layer is responsible for spreading only the provided
// fields onto the update.
import { z } from "zod";

export const createProjectSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric or hyphens"),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  repoUrl: z.url().optional().nullable(),
  targetCost: z.coerce.number().nonnegative().optional().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const editProjectSchema = createProjectSchema.partial().extend({
  id: z.cuid(),
});

export type EditProjectInput = z.infer<typeof editProjectSchema>;
