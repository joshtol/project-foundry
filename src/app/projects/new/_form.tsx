"use client";

// Client form for /projects/new. Uses React 19's `useActionState` to drive
// the form: the server action returns either { errors } (Zod validation
// failure) or redirects on success. Pending state disables the submit
// button and swaps its label per design §9.4.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createProjectFormAction,
  type ProjectFormState,
} from "@/lib/actions/projects";

const initialState: ProjectFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-command-gold bg-navy-dark px-6 py-2 font-mono text-sm uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space disabled:opacity-50"
    >
      {pending ? "WORKING…" : "Create project"}
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

export function NewProjectForm() {
  const [state, formAction] = useActionState(
    createProjectFormAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.message && (
        <p className="border-l-4 border-alert-red bg-navy-dark px-4 py-3 font-mono text-sm font-bold text-alert-red">
          {state.message}
        </p>
      )}

      <div>
        <label
          htmlFor="slug"
          className="block font-mono text-xs uppercase tracking-wider text-muted"
        >
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          required
          maxLength={64}
          pattern="[a-z0-9-]+"
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
        />
        <p className="mt-1 font-mono text-xs text-muted">
          lowercase + digits + hyphens; becomes the URL path
        </p>
        <FieldError messages={state.errors?.slug} />
      </div>

      <div>
        <label
          htmlFor="name"
          className="block font-mono text-xs uppercase tracking-wider text-muted"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={200}
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-serif text-base text-link-muted focus:border-command-gold focus:outline-none"
        />
        <FieldError messages={state.errors?.name} />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block font-mono text-xs uppercase tracking-wider text-muted"
        >
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-serif text-base text-link-muted focus:border-command-gold focus:outline-none"
        />
        <FieldError messages={state.errors?.description} />
      </div>

      <div>
        <label
          htmlFor="repoUrl"
          className="block font-mono text-xs uppercase tracking-wider text-muted"
        >
          Repo URL (optional)
        </label>
        <input
          id="repoUrl"
          name="repoUrl"
          type="url"
          placeholder="https://github.com/you/your-project"
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
        />
        <FieldError messages={state.errors?.repoUrl} />
      </div>

      <div>
        <label
          htmlFor="targetCost"
          className="block font-mono text-xs uppercase tracking-wider text-muted"
        >
          Target cost (optional, USD)
        </label>
        <input
          id="targetCost"
          name="targetCost"
          type="number"
          step="0.01"
          min="0"
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-3 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
        />
        <FieldError messages={state.errors?.targetCost} />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        <a
          href="/"
          className="font-mono text-xs uppercase tracking-wider text-signal-blue underline"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
