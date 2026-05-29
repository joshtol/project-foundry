"use client";

// Inline edit-in-place fields for the project detail page. Each field is a
// tiny client form that renders an input + Save button and submits the
// matching server action. Field errors come back via useActionState.
//
// "Edit in place" is intentionally simple for Phase 1 — server actions
// handle writes; there's no fancy optimistic UI.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  editProjectDescriptionAction,
  editProjectNameAction,
  editProjectRepoUrlAction,
  editProjectTargetCostAction,
  type ProjectFormState,
} from "@/lib/actions/projects";

const initialState: ProjectFormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-panel-border bg-deep-space px-3 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:border-command-gold disabled:opacity-50"
    >
      {pending ? "WORKING…" : "Save"}
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

function ActionMessage({ state }: { state: ProjectFormState }) {
  if (!state.message) return null;
  return (
    <p className="mt-1 font-mono text-xs font-bold text-alert-red">
      {state.message}
    </p>
  );
}

export function EditNameForm({ id, value }: { id: string; value: string }) {
  const [state, action] = useActionState(editProjectNameAction, initialState);
  return (
    <form action={action} className="flex items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="name"
        defaultValue={value}
        required
        maxLength={200}
        className="flex-1 rounded border border-panel-border bg-deep-space px-3 py-2 font-display text-2xl tracking-wider text-command-gold focus:border-command-gold focus:outline-none"
      />
      <SaveButton />
      <FieldError messages={state.errors?.name} />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditDescriptionForm({
  id,
  value,
}: {
  id: string;
  value: string | null;
}) {
  const [state, action] = useActionState(
    editProjectDescriptionAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Description
      </label>
      <textarea
        name="description"
        defaultValue={value ?? ""}
        rows={3}
        maxLength={2000}
        className="w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-serif text-base text-link-muted focus:border-command-gold focus:outline-none"
      />
      <SaveButton />
      <FieldError messages={state.errors?.description} />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditRepoUrlForm({
  id,
  value,
}: {
  id: string;
  value: string | null;
}) {
  const [state, action] = useActionState(
    editProjectRepoUrlAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Repo URL
      </label>
      <input
        name="repoUrl"
        type="url"
        defaultValue={value ?? ""}
        placeholder="https://github.com/you/your-project"
        className="w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
      />
      <SaveButton />
      <FieldError messages={state.errors?.repoUrl} />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditTargetCostForm({
  id,
  value,
}: {
  id: string;
  value: string | null;
}) {
  const [state, action] = useActionState(
    editProjectTargetCostAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block font-mono text-xs uppercase tracking-wider text-muted">
        Target cost (USD)
      </label>
      <input
        name="targetCost"
        type="number"
        step="0.01"
        min="0"
        defaultValue={value ?? ""}
        className="w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
      />
      <SaveButton />
      <FieldError messages={state.errors?.targetCost} />
      <ActionMessage state={state} />
    </form>
  );
}
