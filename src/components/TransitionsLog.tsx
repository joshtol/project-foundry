// Reverse-chrono StageTransition log per design §9.1.
//
// Rendering rules (verbatim from §9.1):
//   - INIT     → "Revision created"
//   - ADVANCE  → "Advanced: {fromStage} → {toStage}"
//   - REGRESS  → "{fromStage} → {toStage}: {reason}"
//
// Phase 5a renders the rows only. Phase 8 (Task 8.5) will enhance the
// gateSnapshot blob display (click-to-expand).
import type { Stage, TransitionDirection } from "@prisma/client";

type TransitionRow = {
  id: string;
  direction: TransitionDirection;
  fromStage: Stage | null;
  toStage: Stage;
  transitionedAt: Date;
  notes: string | null;
  user: { email: string; name: string | null };
};

function formatRow(t: TransitionRow): string {
  if (t.direction === "INIT") return "Revision created";
  if (t.direction === "ADVANCE")
    return `Advanced: ${t.fromStage} → ${t.toStage}`;
  // REGRESS — notes carries the reason per design §5.3.
  return `${t.fromStage} → ${t.toStage}: ${t.notes ?? "(no reason recorded)"}`;
}

export function TransitionsLog({
  transitions,
}: {
  transitions: TransitionRow[];
}) {
  if (transitions.length === 0) {
    return (
      <p className="font-mono text-xs uppercase tracking-wider text-muted">
        NO TRANSITIONS YET.
      </p>
    );
  }

  // Sort reverse-chrono — most recent first.
  const sorted = [...transitions].sort(
    (a, b) => b.transitionedAt.getTime() - a.transitionedAt.getTime(),
  );

  return (
    <ul className="divide-y divide-panel-border">
      {sorted.map((t) => (
        <li key={t.id} className="py-3">
          <p className="font-mono text-sm text-link-muted">{formatRow(t)}</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
            {t.transitionedAt.toISOString().slice(0, 10)} ·{" "}
            {t.user.name ?? t.user.email}
          </p>
        </li>
      ))}
    </ul>
  );
}
