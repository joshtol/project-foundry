// 9-slot horizontal stage tracker (design §8.3, Task 7.2).
//
// Renders the revision's stage progression as nine horizontal slots, each
// with one of four treatments per design §8.3:
//
//   • Active     — currentStage. Filled command-gold with deep-space text.
//   • Completed  — order < currentStage. Outlined command-gold.
//   • Blocked    — active AND exitGate(ctx) fails. Outlined alert-red,
//                  first failure reason inline in Space Mono small text.
//   • Future     — order > currentStage. Outlined muted.
//
// Server component (no client interaction needed). The caller loads
// `ctx` via `loadGateContext` (src/lib/load-gate-context.ts) and passes
// it in — keeping IO at the page boundary, treating the tracker as a
// pure render of `(revision, ctx)`.
//
// Overflow rule (§8.3):
//   • Viewport ≥ 1100px (lg:): full labels visible.
//   • Viewport 700-1099px (md:): truncate to stage number only; full label
//     in HTML `title=` for hover tooltip.
//   • Viewport < 700px: `overflow-x-auto` on the band; `whitespace-nowrap`
//     on the row. Tracker never wraps; outer page does not horizontal-scroll.

import type { Revision } from "@prisma/client";
import {
  STAGES,
  STAGE_LABELS,
  STAGE_ORDER,
  type GateContext,
  type GateResult,
  type StageName,
} from "@/lib/stages";

type Props = {
  revision: Pick<Revision, "currentStage">;
  ctx: GateContext;
};

export async function StageTracker({ revision, ctx }: Props) {
  const currentStage = revision.currentStage as StageName;
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  // Evaluate the active stage's exitGate (if any). Async because gate
  // functions return `GateResult | Promise<GateResult>` per the StageDef
  // signature.
  let activeGateResult: GateResult | null = null;
  const activeDef = STAGES[currentStage];
  if (activeDef.exitGate) {
    activeGateResult = await activeDef.exitGate(ctx);
  }
  const activeIsBlocked = activeGateResult?.ok === false;
  const firstReason =
    activeGateResult && activeGateResult.ok === false
      ? activeGateResult.reasons[0]
      : null;

  return (
    <nav
      aria-label="Stage tracker"
      // < 700px: band-internal horizontal scroll; row never wraps. Outer
      // page does NOT horizontal-scroll (max-w-7xl on the page handles it).
      className="overflow-x-auto border border-panel-border bg-navy-dark p-4"
    >
      <ol className="flex min-w-max items-stretch gap-2 whitespace-nowrap">
        {STAGE_ORDER.map((stage, idx) => {
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          const isBlocked = isActive && activeIsBlocked;
          // `isActive && !isBlocked` reads as the "filled gold" active slot;
          // `isBlocked` overrides to outlined alert-red.

          let slotClass: string;
          if (isBlocked) {
            slotClass =
              "border-alert-red text-alert-red bg-navy-dark";
          } else if (isActive) {
            slotClass =
              "border-command-gold bg-command-gold text-deep-space";
          } else if (isCompleted) {
            slotClass = "border-command-gold text-command-gold bg-navy-dark";
          } else {
            slotClass = "border-muted text-muted bg-navy-dark";
          }

          const num = String(idx + 1).padStart(2, "0");
          const fullLabel = `${num} / ${STAGE_LABELS[stage]}`;
          // `title` is what browsers render as a hover tooltip — used at the
          // 700-1099px range where the label collapses to "01" / "02" / ...
          const titleAttr = fullLabel;

          return (
            <li
              key={stage}
              title={titleAttr}
              className={`flex min-w-[44px] flex-col justify-center rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider lg:min-w-[110px] ${slotClass}`}
            >
              {/* Compact label: only the number at < lg, full label at lg+ */}
              <span className="block lg:hidden">{num}</span>
              <span className="hidden lg:block">{fullLabel}</span>
              {/*
                Blocked-slot inline reason — only ever rendered on the active
                slot when its gate fails. Space Mono small text per §8.3.
                Hidden below md to keep the < 700px band compact (the page
                surfaces the same reason elsewhere via the gate block).
              */}
              {isBlocked && firstReason ? (
                <span className="mt-1 hidden font-mono text-[10px] normal-case tracking-normal text-alert-red md:block">
                  {firstReason}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
