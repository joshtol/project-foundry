"use server";

// useActionState-compatible form-action wrappers for the Erratum CRUD
// surface (Task 11.2). Mirrors the project / revision / artifact form
// helpers — pulls strings out of FormData, dispatches to the canonical
// action, and surfaces ZodError per-field or a single `message` for
// non-validation rejections (e.g., the same-project link guard).
import { ZodError } from "zod";
import { ErratumSeverity, ErratumStatus } from "@prisma/client";
import {
  createErratum,
  deleteErratum,
  editErratum,
  linkErratumToRevision,
} from "@/lib/actions/errata";

export type ErratumFormState = {
  errors?: Record<string, string[]>;
  message?: string;
  createdId?: string;
  ok?: boolean;
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

export async function createErratumFormAction(
  _prev: ErratumFormState,
  formData: FormData,
): Promise<ErratumFormState> {
  const revisionId = pickString(formData, "revisionId");
  const title = pickString(formData, "title");
  // Description allows whitespace-sensitive multi-line markdown — don't trim.
  const description = pickRaw(formData, "description");
  const severityRaw = pickString(formData, "severity");
  const statusRaw = pickString(formData, "status");
  const addressedByRevisionId = pickString(formData, "addressedByRevisionId");

  if (!revisionId) return { message: "Missing revisionId." };
  if (severityRaw && !(severityRaw in ErratumSeverity)) {
    return { message: "Invalid severity." };
  }
  if (statusRaw && !(statusRaw in ErratumStatus)) {
    return { message: "Invalid status." };
  }

  try {
    const e = await createErratum({
      revisionId,
      title,
      description,
      severity: severityRaw,
      status: statusRaw,
      addressedByRevisionId,
    });
    return { createdId: e.id, ok: true };
  } catch (err) {
    if (err instanceof ZodError) {
      return { errors: zodErrors(err) };
    }
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function editErratumFormAction(
  _prev: ErratumFormState,
  formData: FormData,
): Promise<ErratumFormState> {
  const id = pickString(formData, "id");
  if (!id) return { message: "Missing erratum id." };

  const title = pickString(formData, "title");
  const description = pickRaw(formData, "description");
  const severityRaw = pickString(formData, "severity");
  const statusRaw = pickString(formData, "status");

  if (severityRaw && !(severityRaw in ErratumSeverity)) {
    return { message: "Invalid severity." };
  }
  if (statusRaw && !(statusRaw in ErratumStatus)) {
    return { message: "Invalid status." };
  }

  try {
    await editErratum({
      id,
      title,
      description,
      severity: severityRaw,
      status: statusRaw,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ZodError) {
      return { errors: zodErrors(err) };
    }
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function linkErratumFormAction(
  _prev: ErratumFormState,
  formData: FormData,
): Promise<ErratumFormState> {
  const id = pickString(formData, "id");
  const addressedByRevisionId = pickString(formData, "addressedByRevisionId");
  if (!id) return { message: "Missing erratum id." };
  if (!addressedByRevisionId) {
    return { message: "Select a revision to link to." };
  }
  try {
    await linkErratumToRevision({ id, addressedByRevisionId });
    return { ok: true };
  } catch (err) {
    if (err instanceof ZodError) {
      return { errors: zodErrors(err) };
    }
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function deleteErratumFormAction(
  _prev: ErratumFormState,
  formData: FormData,
): Promise<ErratumFormState> {
  const id = pickString(formData, "id");
  if (!id) return { message: "Missing erratum id." };
  try {
    await deleteErratum({ id });
    return { ok: true };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}
