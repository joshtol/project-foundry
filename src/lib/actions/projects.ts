"use server";

// Project CRUD server actions. Every entry point validates input via Zod
// (per design §3), resolves the calling User via `requireUser`, and
// revalidates the affected routes so server-rendered lists/detail pages
// pick up the change without a full reload.
//
// Phase 4 scope: create / edit / archive / unarchive. Revisions, Builds, etc.
// land in later phases.

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import {
  createProjectSchema,
  editProjectSchema,
} from "@/lib/schemas/project";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

export async function createProject(input: unknown) {
  const data = createProjectSchema.parse(input);
  const user = await requireUser();
  const project = await db.project.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      repoUrl: data.repoUrl ?? null,
      targetCost: data.targetCost ?? null,
      createdById: user.id,
    },
  });
  revalidatePath("/");
  return project;
}

export async function editProject(input: unknown) {
  const { id, ...rest } = editProjectSchema.parse(input);
  await requireUser();

  // Drop undefined fields so Prisma only updates what the caller supplied.
  // (Zod .partial() makes everything optional; we mustn't write `null` over
  // a field the user didn't touch.)
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) data[k] = v;
  }

  const updated = await db.project.update({ where: { id }, data });

  revalidatePath("/");
  // Use the post-update slug as the source of truth — covers both the
  // slug-unchanged case and a slug rename (both old and new path are valid
  // targets to invalidate; the old path won't 404 because the row still
  // exists under its new slug, but the cache entry is stale either way).
  revalidatePath(`/projects/${updated.slug}`);
  return updated;
}

export async function archiveProject(id: string) {
  await requireUser();
  await db.project.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/");
}

export async function unarchiveProject(id: string) {
  await requireUser();
  await db.project.update({
    where: { id },
    data: { archivedAt: null },
  });
  revalidatePath("/");
}

// ─── Form action wrappers (useActionState-compatible) ──────────────────
// React 19 / Next 16 form actions receive (prevState, formData) and return
// the next state. We adapt FormData → parsed input here so the page-level
// client component can drive form rendering without re-implementing Zod.

export type ProjectFormState = {
  errors?: Record<string, string[]>;
  message?: string;
};

function pickString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function createProjectFormAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const raw = {
    slug: pickString(formData, "slug"),
    name: pickString(formData, "name"),
    description: pickString(formData, "description"),
    repoUrl: pickString(formData, "repoUrl"),
    targetCost: pickString(formData, "targetCost"),
  };

  let createdSlug: string;
  try {
    const project = await createProject(raw);
    createdSlug = project.slug;
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

  // Outside the try so Next.js's redirect-throw isn't swallowed by the catch.
  redirect(`/projects/${createdSlug}`);
}

// Edit-in-place wrappers for the detail page. Each one accepts the project
// id (via hidden input) plus exactly one editable field. They route through
// editProject for validation + audit, then revalidate.
//
// On Zod failure, the field error is surfaced via useActionState state;
// otherwise the action completes silently (the revalidate is what refreshes
// the page).

async function editProjectSingleField(
  fieldName: "name" | "description" | "repoUrl" | "targetCost",
  formData: FormData,
): Promise<ProjectFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { message: "Missing project id" };
  }
  const raw = pickString(formData, fieldName);
  // null sentinel: empty value clears optional nullable fields.
  const value =
    fieldName === "name"
      ? raw
      : raw === undefined
        ? null
        : raw;

  try {
    await editProject({ id, [fieldName]: value });
    return {};
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

export async function editProjectNameAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  return editProjectSingleField("name", formData);
}

export async function editProjectDescriptionAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  return editProjectSingleField("description", formData);
}

export async function editProjectRepoUrlAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  return editProjectSingleField("repoUrl", formData);
}

export async function editProjectTargetCostAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  return editProjectSingleField("targetCost", formData);
}

export async function archiveProjectAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Missing project id");
  }
  await archiveProject(id);
}

export async function unarchiveProjectAction(
  formData: FormData,
): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Missing project id");
  }
  await unarchiveProject(id);
}
