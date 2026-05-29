"use server";

// useActionState-compatible form-action wrapper for createBuild. Kept in a
// separate file from builds.ts so Next.js's redirect-throw isn't caught by
// the editBuild* wrappers' generic ZodError handlers.
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { createBuild } from "@/lib/actions/builds";

export type CreateBuildFormState = {
  errors?: Record<string, string[]>;
  message?: string;
};

function pickString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function createBuildFormAction(
  _prev: CreateBuildFormState,
  formData: FormData,
): Promise<CreateBuildFormState> {
  const revisionId = pickString(formData, "revisionId");
  const label = pickString(formData, "label");
  const boardCount = pickString(formData, "boardCount");

  let target: string;
  try {
    const build = await createBuild({ revisionId, label, boardCount });
    // Resolve the canonical redirect target (slug + revLabel + buildLabel).
    const ctx = await db.build.findUniqueOrThrow({
      where: { id: build.id },
      select: {
        label: true,
        revision: {
          select: {
            label: true,
            project: { select: { slug: true } },
          },
        },
      },
    });
    target = `/projects/${ctx.revision.project.slug}/${encodeURIComponent(
      ctx.revision.label,
    )}/builds/${encodeURIComponent(ctx.label)}`;
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

  // Outside the try so Next.js's redirect-throw isn't caught.
  redirect(target);
}
