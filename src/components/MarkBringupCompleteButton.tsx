"use client";

// Mark-bring-up-complete button (design §9.2).
//
// Visibility, computed by the parent server component:
//   • parent revision is at stage BRINGUP
//   • this Build is the active (unfrozen) Build
//   • no BRINGUP_COMPLETE artifact exists on this Build yet
//
// Disabled state — when any board's status is NOT in {BROUGHT_UP, QUARANTINED}.
// Tooltip (HTML `title=` attr) lists up to 5 blocking serials, then `…and N
// more` if more exist (design §9.2 truncation rule). Full list reachable via
// the Boards table below the header strip.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  markBringupCompleteAction,
  type BringupCompleteFormState,
} from "@/lib/actions/bringup";

const initialState: BringupCompleteFormState = {};

function SubmitButton({ tooltip }: { tooltip?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={tooltip}
      className="rounded border border-command-gold bg-command-gold px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-deep-space transition-colors hover:bg-deep-space hover:text-command-gold disabled:opacity-50"
    >
      {pending ? "WORKING…" : "Mark bring-up complete"}
    </button>
  );
}

export function MarkBringupCompleteButton({
  buildId,
  blockingSerials,
}: {
  buildId: string;
  /** Empty array → enabled. Non-empty → disabled with the §9.2 truncated tooltip. */
  blockingSerials: string[];
}) {
  const [state, action] = useActionState(
    markBringupCompleteAction,
    initialState,
  );

  if (blockingSerials.length > 0) {
    const sample = blockingSerials.slice(0, 5).join(", ");
    const more =
      blockingSerials.length > 5
        ? ` …and ${blockingSerials.length - 5} more`
        : "";
    const tooltip = `Boards not yet BROUGHT_UP or QUARANTINED: ${sample}${more}`;
    return (
      <button
        type="button"
        disabled
        title={tooltip}
        className="rounded border border-panel-border bg-deep-space px-3 py-1 font-mono text-xs uppercase tracking-wider text-muted opacity-60"
      >
        Mark bring-up complete
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="buildId" value={buildId} />
      <SubmitButton />
      {state.message ? (
        <p className="max-w-xs border-l-4 border-alert-red bg-deep-space px-3 py-1 text-right font-mono text-xs font-bold text-alert-red">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
