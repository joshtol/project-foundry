// Reverse-chrono StageTransition log per design §9.1.
//
// Rendering rules (verbatim from §9.1):
//   - INIT     → "Revision created"
//   - ADVANCE  → "Advanced: {fromStage} → {toStage}"
//   - REGRESS  → "{fromStage} → {toStage}: {reason}"
//
// Stage names render in `text-command-gold` to anchor the eye; the
// timestamp + actor line stays `text-muted` (design §8.1 typography rule).
// Multi-stage skip-regress rows (e.g., `BRINGUP → ORDERING` from
// createBuild) read naturally with the spread.
import type { ReactNode } from "react";
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

function Stagepiece({ stage }: { stage: Stage | null }) {
  return (
    <span className="font-mono text-sm text-command-gold">
      {stage ?? "—"}
    </span>
  );
}

function renderRow(t: TransitionRow): ReactNode {
  if (t.direction === "INIT") {
    return (
      <span className="font-mono text-sm text-link-muted">
        Revision created
      </span>
    );
  }
  if (t.direction === "ADVANCE") {
    return (
      <span className="font-mono text-sm text-link-muted">
        Advanced: <Stagepiece stage={t.fromStage} />{" "}
        <span className="text-muted">→</span>{" "}
        <Stagepiece stage={t.toStage} />
      </span>
    );
  }
  // REGRESS — notes carries the reason per design §5.3.
  return (
    <span className="font-mono text-sm text-link-muted">
      <Stagepiece stage={t.fromStage} />{" "}
      <span className="text-muted">→</span>{" "}
      <Stagepiece stage={t.toStage} />:{" "}
      <span className="text-link-muted">
        {t.notes ?? "(no reason recorded)"}
      </span>
    </span>
  );
}

export function TransitionsLog({
  transitions,
}: {
  transitions: TransitionRow[];
}) {
  if (transitions.length === 0) {
    return (
      <p className="font-mono text-sm uppercase tracking-wider text-muted">
        NO TRANSITIONS — ADVANCE THE STAGE TO BEGIN.
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
          <p>{renderRow(t)}</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
            {t.transitionedAt.toISOString().slice(0, 10)} ·{" "}
            {t.user.name ?? t.user.email}
          </p>
        </li>
      ))}
    </ul>
  );
}
