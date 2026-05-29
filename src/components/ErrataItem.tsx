"use client";

// Erratum row + inline edit / delete / link forms (Task 11.2).
//
// Companion to ErrataPane (server-side list shell). One <ErrataItem> per
// row; expand-to-edit pattern mirrors the BomEditor / ArtifactPicker
// approach. Three sub-forms:
//   1. Edit (title/description/severity/status) — useActionState +
//      editErratumFormAction.
//   2. Link to next-rev (dropdown of same-project revisions) —
//      linkErratumFormAction.
//   3. Delete — deleteErratumFormAction, single confirm.
//
// Severity pill color rule per design §8.3 (with the §11.2 plan extension
// for severities): BLOCKER → alert-red text, MAJOR → command-gold text,
// MINOR → muted text. Status pill rule: OPEN → alert-red, FIXED_NEXT_REV
// → command-gold, WONT_FIX → muted. Both sit on a navy-dark chip
// background with 1px panel-border per the §8.3 pill anatomy.
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ErratumSeverity, ErratumStatus } from "@prisma/client";
import {
  deleteErratumFormAction,
  editErratumFormAction,
  type ErratumFormState,
  linkErratumFormAction,
} from "@/lib/actions/errata-form";

const initialState: ErratumFormState = {};

const SEVERITIES: ErratumSeverity[] = ["BLOCKER", "MAJOR", "MINOR"];
const STATUSES: ErratumStatus[] = ["OPEN", "FIXED_NEXT_REV", "WONT_FIX"];

// Tailwind class strings keyed off the enum value. Inlined so PurgeCSS can
// see them at build time.
function severityPillClasses(sev: ErratumSeverity): string {
  // Common: navy-dark chip + 1px panel-border + Space Mono caps (§8.3).
  const base =
    "inline-block rounded border bg-navy-dark px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider";
  switch (sev) {
    case "BLOCKER":
      return `${base} border-panel-border text-alert-red`;
    case "MAJOR":
      return `${base} border-panel-border text-command-gold`;
    case "MINOR":
      return `${base} border-panel-border text-muted`;
  }
}

function statusPillClasses(status: ErratumStatus): string {
  const base =
    "inline-block rounded border bg-navy-dark px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider";
  switch (status) {
    case "OPEN":
      return `${base} border-panel-border text-alert-red`;
    case "FIXED_NEXT_REV":
      return `${base} border-panel-border text-command-gold`;
    case "WONT_FIX":
      return `${base} border-panel-border text-muted`;
  }
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-command-gold bg-navy-dark px-2 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space disabled:opacity-50"
    >
      {pending ? "WORKING…" : label}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-panel-border bg-navy-dark px-2 py-1 font-mono text-xs uppercase tracking-wider text-alert-red transition-colors hover:bg-alert-red hover:text-deep-space disabled:opacity-50"
    >
      {pending ? "WORKING…" : "Delete"}
    </button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p className="mt-1 font-mono text-xs font-bold text-alert-red">
      {messages.join("; ")}
    </p>
  );
}

export type ErratumRowData = {
  id: string;
  title: string;
  description: string;
  severity: ErratumSeverity;
  status: ErratumStatus;
  addressedByRevisionId: string | null;
  addressedByLabel: string | null;
  /** Pre-built href for the addressed-by revision (when set). */
  addressedByHref: string | null;
};

export type LinkableRevisionOption = {
  id: string;
  label: string;
};

export function ErrataItem({
  erratum,
  linkableRevisions,
}: {
  erratum: ErratumRowData;
  /** Revisions in the same project that can address this erratum. */
  linkableRevisions: LinkableRevisionOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction] = useActionState(
    editErratumFormAction,
    initialState,
  );
  const [linkState, linkAction] = useActionState(
    linkErratumFormAction,
    initialState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteErratumFormAction,
    initialState,
  );

  // Long descriptions collapse by default; toggle expands inline.
  const longDescription = erratum.description.length > 240;
  const [expanded, setExpanded] = useState(!longDescription);

  return (
    <li className="space-y-2 py-3 font-mono text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={severityPillClasses(erratum.severity)}>
              {erratum.severity}
            </span>
            <span className={statusPillClasses(erratum.status)}>
              {erratum.status}
            </span>
          </div>
          <p className="mt-1 font-serif text-base text-white">
            {erratum.title}
          </p>
          {erratum.addressedByLabel && erratum.addressedByHref ? (
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
              Addressed by{" "}
              <a
                href={erratum.addressedByHref}
                className="text-link-muted underline"
              >
                {erratum.addressedByLabel}
              </a>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded border border-panel-border bg-navy-dark px-2 py-1 font-mono text-xs uppercase tracking-wider text-link-muted hover:border-command-gold hover:text-command-gold"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>

      {/* Description — collapsible if long. */}
      <div>
        <p
          className={`font-serif text-sm text-muted whitespace-pre-wrap ${
            !expanded ? "line-clamp-3" : ""
          }`}
        >
          {erratum.description}
        </p>
        {longDescription ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 font-mono text-xs uppercase tracking-wider text-signal-blue underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <form action={editAction} className="space-y-2 border-t border-panel-border pt-3">
          <input type="hidden" name="id" value={erratum.id} />

          {editState.message ? (
            <p className="border-l-4 border-alert-red bg-deep-space px-3 py-2 font-mono text-xs font-bold text-alert-red">
              {editState.message}
            </p>
          ) : null}

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-muted">
              Title
            </label>
            <input
              name="title"
              defaultValue={erratum.title}
              maxLength={200}
              className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
            />
            <FieldError messages={editState.errors?.title} />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-muted">
              Description
            </label>
            <textarea
              name="description"
              defaultValue={erratum.description}
              rows={4}
              className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-serif text-sm text-link-muted focus:border-command-gold focus:outline-none"
            />
            <FieldError messages={editState.errors?.description} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-muted">
                Severity
              </label>
              <select
                name="severity"
                defaultValue={erratum.severity}
                className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-muted">
                Status
              </label>
              <select
                name="status"
                defaultValue={erratum.status}
                className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SubmitButton label="Save" />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-panel-border bg-navy-dark px-2 py-1 font-mono text-xs uppercase tracking-wider text-muted hover:border-command-gold hover:text-command-gold"
            >
              Done
            </button>
          </div>
        </form>
      ) : null}

      {/* Link-to-next-rev form (always available, even when not in edit mode). */}
      {linkableRevisions.length > 0 ? (
        <form
          action={linkAction}
          className="flex flex-wrap items-end gap-2 border-t border-panel-border pt-3"
        >
          <input type="hidden" name="id" value={erratum.id} />
          <div className="min-w-0 flex-1">
            <label className="block font-mono text-xs uppercase tracking-wider text-muted">
              Link to next-rev fix
            </label>
            <select
              name="addressedByRevisionId"
              defaultValue=""
              className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
            >
              <option value="">— select revision —</option>
              {linkableRevisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton label="Link" />
          {linkState.message ? (
            <p className="w-full border-l-4 border-alert-red bg-deep-space px-3 py-2 font-mono text-xs font-bold text-alert-red">
              {linkState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {/* Delete form. */}
      <form action={deleteAction} className="flex items-center justify-end">
        <input type="hidden" name="id" value={erratum.id} />
        <DeleteButton />
      </form>
      {deleteState.message ? (
        <p className="border-l-4 border-alert-red bg-deep-space px-3 py-2 font-mono text-xs font-bold text-alert-red">
          {deleteState.message}
        </p>
      ) : null}
    </li>
  );
}
