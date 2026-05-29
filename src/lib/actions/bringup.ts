"use server";

// Mark-bring-up-complete server action (design §9.2).
//
// `BRINGUP_COMPLETE` is the one artifact subkind that is NEVER reachable via
// the standard picker — design §9.2 explicitly removes it from the picker
// and routes creation through this dedicated action. The action is the only
// path to the BRINGUP gate's "user-confirmed complete" signal.
//
// Server-side checks (in order, inside a Serializable tx):
//   1. requireUser() — audit + identity.
//   2. Load build with its boards + parent revision.
//   3. Build.frozenAt must be null.
//   4. Revision.frozenAt must be null.
//   5. Every board's status ∈ {BROUGHT_UP, QUARANTINED}. Otherwise reject
//      with the §9.2 truncated message: up to 5 blocking serials, then
//      "…and N more" if more exist.
//   6. No prior BRINGUP_COMPLETE artifact on this Build (idempotency).
//   7. Insert the BRINGUP_COMPLETE artifact with the canonical body.
//
// The button on the Build header is gated by visibility + disabled-state on
// the client (read-side mirror of the same checks); this action is the
// authoritative gatekeeper.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { withTxRetry } from "@/lib/tx-retry";

const BRINGUP_BOARD_ALLOWED = new Set(["BROUGHT_UP", "QUARANTINED"]);

function bringupCompleteBlockingMessage(blockingSerials: string[]): string {
  const sample = blockingSerials.slice(0, 5).join(", ");
  const more =
    blockingSerials.length > 5
      ? ` …and ${blockingSerials.length - 5} more`
      : "";
  return `Blocked by boards not BROUGHT_UP or QUARANTINED: ${sample}${more}`;
}

export async function markBringupComplete(buildId: string) {
  if (typeof buildId !== "string" || buildId.length === 0) {
    throw new Error("Missing buildId.");
  }
  const user = await requireUser();

  const { artifact, projectSlug, revLabel, buildLabel } = await withTxRetry(
    () =>
      db.$transaction(
        async (tx) => {
          const build = await tx.build.findUniqueOrThrow({
            where: { id: buildId },
            include: {
              boards: { orderBy: { serial: "asc" } },
              revision: {
                select: {
                  label: true,
                  frozenAt: true,
                  project: { select: { slug: true } },
                },
              },
            },
          });

          if (build.frozenAt) throw new Error("Build is frozen.");
          if (build.revision.frozenAt) throw new Error("Revision is frozen.");

          const blocking = build.boards.filter(
            (b) => !BRINGUP_BOARD_ALLOWED.has(b.status),
          );
          if (blocking.length > 0) {
            throw new Error(
              bringupCompleteBlockingMessage(blocking.map((b) => b.serial)),
            );
          }

          const existing = await tx.artifact.findFirst({
            where: { buildId, subkind: "BRINGUP_COMPLETE" },
            select: { id: true },
          });
          if (existing) {
            throw new Error("Bring-up already marked complete on this Build.");
          }

          const created = await tx.artifact.create({
            data: {
              buildId,
              stage: "BRINGUP",
              kind: "NOTE",
              subkind: "BRINGUP_COMPLETE",
              title: "Bring-up complete",
              noteBody:
                "User-confirmed bring-up complete. Advancing to REVISION will freeze the rev.",
              createdBy: user.id,
            },
          });

          return {
            artifact: created,
            projectSlug: build.revision.project.slug,
            revLabel: build.revision.label,
            buildLabel: build.label,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
  );

  revalidatePath(
    `/projects/${projectSlug}/${encodeURIComponent(revLabel)}/builds/${encodeURIComponent(buildLabel)}`,
  );
  revalidatePath(
    `/projects/${projectSlug}/${encodeURIComponent(revLabel)}`,
  );

  return artifact;
}

// ─── Form action wrapper (useActionState-compatible) ───────────────────

export type BringupCompleteFormState = {
  message?: string;
  createdId?: string;
};

export async function markBringupCompleteAction(
  _prev: BringupCompleteFormState,
  formData: FormData,
): Promise<BringupCompleteFormState> {
  const buildId = formData.get("buildId");
  if (typeof buildId !== "string" || buildId.length === 0) {
    return { message: "Missing buildId." };
  }
  try {
    const artifact = await markBringupComplete(buildId);
    return { createdId: artifact.id };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "Unknown error" };
  }
}
