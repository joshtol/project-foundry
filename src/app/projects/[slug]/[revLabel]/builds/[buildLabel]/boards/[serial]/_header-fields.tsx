"use client";

// Inline-edit fields for the Board detail header strip (design §9.3).
//
// Mirrors the Build _header-fields.tsx pattern: useActionState + a tiny
// per-field form. Each field calls a dedicated server action so freeze
// policy fires per write — a mid-edit freeze takes effect on the next
// field's submit, not via a page-level toggle.
//
// silkscreenHash has client-side Zod-equivalent validation via the same
// SILKSCREEN_HASH_RE constant the server enforces.
//
// Status renders as a <select> with all 7 BoardStatus values; submit fires
// on change so the user gets the canonical inline-save feel.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { BoardStatus } from "@prisma/client";
import {
  editBoardNotesAction,
  editBoardSilkscreenHashAction,
  editBoardStatusAction,
  type EditBoardFormState,
} from "@/lib/actions/boards-form";
import { SILKSCREEN_HASH_RE } from "@/lib/constants";

const initialState: EditBoardFormState = {};

function SaveButton({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-panel-border bg-deep-space px-3 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:border-command-gold disabled:opacity-50"
    >
      {pending ? "WORKING…" : label}
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

function ActionMessage({ state }: { state: EditBoardFormState }) {
  if (!state.message) return null;
  return (
    <p className="mt-1 font-mono text-xs font-bold text-alert-red">
      {state.message}
    </p>
  );
}

function DisabledNote({ reason }: { reason?: string }) {
  if (!reason) return null;
  return (
    <p className="mt-1 font-mono text-xs font-bold text-alert-red">{reason}</p>
  );
}

type CommonProps = {
  id: string;
  disabled?: boolean;
  disabledReason?: string;
};

// ─── silkscreenHash ─────────────────────────────────────────────────────

export function BoardSilkscreenHashField({
  id,
  value,
  disabled,
  disabledReason,
}: CommonProps & { value: string | null }) {
  const [state, action] = useActionState(
    editBoardSilkscreenHashAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Silkscreen hash
      </label>
      <div className="flex items-start gap-2">
        <input
          name="silkscreenHash"
          defaultValue={value ?? ""}
          disabled={disabled}
          maxLength={64}
          pattern={SILKSCREEN_HASH_RE.source}
          placeholder="g1ebc1cc"
          className="flex-1 rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none disabled:opacity-50"
        />
        <SaveButton />
      </div>
      <p className="font-mono text-xs text-muted">
        git short or long hash (7-40 hex, optional &lsquo;g&rsquo; prefix); empty to clear
      </p>
      <DisabledNote reason={disabled ? disabledReason : undefined} />
      <FieldError messages={state.errors?.silkscreenHash} />
      <ActionMessage state={state} />
    </form>
  );
}

// ─── status ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS: BoardStatus[] = [
  "BARE",
  "SCREENED",
  "ASSEMBLED",
  "POWERED",
  "BROUGHT_UP",
  "FAILED",
  "QUARANTINED",
];

export function BoardStatusField({
  id,
  value,
  disabled,
  disabledReason,
}: CommonProps & { value: BoardStatus }) {
  const [state, action] = useActionState(
    editBoardStatusAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Status
      </label>
      <div className="flex items-start gap-2">
        <select
          name="status"
          defaultValue={value}
          disabled={disabled}
          className="flex-1 rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm uppercase tracking-wider text-link-muted focus:border-command-gold focus:outline-none disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <SaveButton />
      </div>
      <DisabledNote reason={disabled ? disabledReason : undefined} />
      <FieldError messages={state.errors?.status} />
      <ActionMessage state={state} />
    </form>
  );
}

// ─── notes ──────────────────────────────────────────────────────────────

export function BoardNotesField({
  id,
  value,
  disabled,
  disabledReason,
}: CommonProps & { value: string | null }) {
  const [state, action] = useActionState(editBoardNotesAction, initialState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Notes
      </label>
      <textarea
        name="notes"
        defaultValue={value ?? ""}
        disabled={disabled}
        rows={3}
        maxLength={4000}
        className="w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-serif text-base text-link-muted focus:border-command-gold focus:outline-none disabled:opacity-50"
      />
      <SaveButton />
      <DisabledNote reason={disabled ? disabledReason : undefined} />
      <FieldError messages={state.errors?.notes} />
      <ActionMessage state={state} />
    </form>
  );
}
