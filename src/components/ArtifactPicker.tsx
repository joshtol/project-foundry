"use client";

// Artifact picker (design §9.1, §9.2).
//
// Per-stage create form for NOTE + LINK artifacts. FILE-kind ships in
// Phase 10 (M8b) when the R2 presigned-PUT path lands. Mounted twice:
//   - Revision detail page (owner.kind = "revision"), scoped to
//     STAGES[stage].revisionAllowedArtifactSubkinds.
//   - Build detail page (owner.kind = "build"), scoped to
//     STAGES[stage].buildAllowedArtifactSubkinds.
//
// BRINGUP_COMPLETE is intentionally absent from buildAllowedArtifactSubkinds
// per design §9.2 — that subkind is created ONLY via the dedicated "Mark
// bring-up complete" button. We additionally filter it out client-side here
// as belt-and-braces, and the server rejects it on the stage-allowed check.
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ArtifactSubkind, Stage } from "@prisma/client";
import {
  createArtifactFormAction,
  type ArtifactFormState,
} from "@/lib/actions/artifacts";
import { STAGES } from "@/lib/stages";

type Owner = { kind: "revision" | "build"; id: string };

const initialState: ArtifactFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-command-gold bg-navy-dark px-3 py-2 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space disabled:opacity-50"
    >
      {pending ? "WORKING…" : "Add artifact"}
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

export function ArtifactPicker({
  owner,
  stage,
  onCreated,
}: {
  owner: Owner;
  stage: Stage;
  onCreated?: () => void;
}) {
  const [state, action] = useActionState(
    createArtifactFormAction,
    initialState,
  );
  const [kind, setKind] = useState<"NOTE" | "LINK">("NOTE");
  const [preview, setPreview] = useState(false);
  const [noteBody, setNoteBody] = useState("");

  const allAllowed =
    owner.kind === "revision"
      ? STAGES[stage].revisionAllowedArtifactSubkinds
      : STAGES[stage].buildAllowedArtifactSubkinds;
  // Belt-and-braces: filter out BRINGUP_COMPLETE — it's never picker-created
  // per design §9.2 (and not currently in any allowed-list either; this is
  // defensive for the case where the const is later edited carelessly).
  const allowedSubkinds = allAllowed.filter(
    (s) => s !== ("BRINGUP_COMPLETE" satisfies ArtifactSubkind),
  );

  // Clear local form state + fire onCreated callback when a create succeeds.
  useEffect(() => {
    if (state.createdId) {
      setNoteBody("");
      setPreview(false);
      onCreated?.();
    }
  }, [state.createdId, onCreated]);

  if (allowedSubkinds.length === 0) {
    // No subkinds allowed for this owner-kind at this stage — render nothing
    // so the surrounding pane can show its own empty/placeholder copy.
    return null;
  }

  return (
    <form action={action} className="space-y-3 font-mono text-sm text-link-muted">
      <input type="hidden" name="ownerKind" value={owner.kind} />
      <input type="hidden" name="ownerId" value={owner.id} />
      <input type="hidden" name="stage" value={stage} />

      {state.message && (
        <p className="border-l-4 border-alert-red bg-deep-space px-3 py-2 font-mono text-sm font-bold text-alert-red">
          {state.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="block font-mono text-xs uppercase tracking-wider text-muted">
            Subkind
          </label>
          <select
            name="subkind"
            defaultValue={allowedSubkinds[0]}
            className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
          >
            {allowedSubkinds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <FieldError messages={state.errors?.subkind} />
        </div>

        <div>
          <label className="block font-mono text-xs uppercase tracking-wider text-muted">
            Kind
          </label>
          <div className="mt-1 flex gap-3 font-mono text-xs uppercase tracking-wider text-link-muted">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="kind"
                value="NOTE"
                checked={kind === "NOTE"}
                onChange={() => setKind("NOTE")}
              />
              NOTE
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="kind"
                value="LINK"
                checked={kind === "LINK"}
                onChange={() => setKind("LINK")}
              />
              LINK
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="block font-mono text-xs uppercase tracking-wider text-muted">
          Title
        </label>
        <input
          name="title"
          required
          maxLength={200}
          className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
        />
        <FieldError messages={state.errors?.title} />
      </div>

      {kind === "NOTE" ? (
        <div>
          <div className="flex items-center justify-between">
            <label className="block font-mono text-xs uppercase tracking-wider text-muted">
              Note (markdown)
            </label>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="rounded border border-panel-border bg-deep-space px-2 py-1 font-mono text-xs uppercase tracking-wider text-link-muted hover:border-command-gold"
            >
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
          {preview ? (
            <pre className="mt-1 max-h-60 w-full overflow-auto rounded border border-panel-border bg-deep-space px-2 py-2 font-serif text-sm text-link-muted whitespace-pre-wrap">
              {noteBody || "(empty)"}
            </pre>
          ) : (
            <textarea
              name="noteBody"
              required
              rows={6}
              maxLength={50_000}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-serif text-sm text-link-muted focus:border-command-gold focus:outline-none"
            />
          )}
          <FieldError messages={state.errors?.noteBody} />
        </div>
      ) : (
        <div>
          <label className="block font-mono text-xs uppercase tracking-wider text-muted">
            Link URL
          </label>
          <input
            name="linkUrl"
            type="url"
            required
            maxLength={2048}
            className="mt-1 w-full rounded border border-panel-border bg-deep-space px-2 py-2 font-mono text-sm text-link-muted focus:border-command-gold focus:outline-none"
          />
          <FieldError messages={state.errors?.linkUrl} />
        </div>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
