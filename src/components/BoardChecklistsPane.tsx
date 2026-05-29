// Board-scoped Checklists pane (Task 13.3 / design §9.3 right column).
//
// Sibling to BuildChecklistsPane — same layout shape, different
// `ownerKind` and a Board-scope subkind allow-list (§9.3):
//   SCREENING_STEP_0 | ASSEMBLY_STEPS | GENERIC
//
// Inline ChecklistEditor on every row mirrors the Build pane. Freeze guard
// is parented through `disabled` + `disabledReason`; the server backs it
// up with the same assertNotFrozen + assertBuildNotFrozen pair (resolved
// via board.buildId) on every mutation path.
import type {
  ChecklistSubkind,
  Stage,
  Checklist,
  ChecklistItem,
} from "@prisma/client";
import { ChecklistEditor } from "./ChecklistEditor";
import { NewChecklistDialog } from "./NewChecklistDialog";

const BOARD_SUBKINDS: ChecklistSubkind[] = [
  "SCREENING_STEP_0",
  "ASSEMBLY_STEPS",
  "GENERIC",
];

export type BoardChecklistInput = Checklist & {
  items: ChecklistItem[];
};

function checklistSubkindPillClasses(subkind: ChecklistSubkind): string {
  const base =
    "inline-block rounded border bg-navy-dark px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider";
  // SCREENING_STEP_0 is the canonical board-scope subkind — emphasise.
  if (subkind === "SCREENING_STEP_0") {
    return `${base} border-command-gold text-command-gold`;
  }
  return `${base} border-panel-border text-link-muted`;
}

export function BoardChecklistsPane({
  boardId,
  checklists,
  stage,
  disabled,
  disabledReason,
}: {
  boardId: string;
  checklists: BoardChecklistInput[];
  stage: Stage;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <section className="border border-panel-border bg-navy-dark p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl tracking-wider text-white">
          BOARD CHECKLISTS
        </h2>
        <NewChecklistDialog
          ownerKind="board"
          ownerId={boardId}
          stage={stage}
          allowedSubkinds={BOARD_SUBKINDS}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </div>

      {checklists.length === 0 ? (
        <p className="mt-4 font-mono text-sm uppercase tracking-wider text-muted">
          NO CHECKLISTS — CREATE ONE TO BEGIN.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-panel-border">
          {checklists.map((c) => {
            const total = c.items.length;
            const done = c.items.filter((i) => i.checked).length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            return (
              <li key={c.id} className="space-y-3 py-4 font-mono text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base text-white">{c.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={checklistSubkindPillClasses(c.subkind)}>
                        {c.subkind}
                      </span>
                      <span className="font-mono text-xs uppercase tracking-wider text-muted">
                        {c.stage}
                      </span>
                      <span className="font-mono text-xs uppercase tracking-wider text-muted">
                        {done}/{total} · {pct}%
                      </span>
                    </div>
                  </div>
                </div>
                <ChecklistEditor
                  checklistId={c.id}
                  items={c.items.map((i) => ({
                    id: i.id,
                    ordinal: i.ordinal,
                    label: i.label,
                    expectedValue: i.expectedValue,
                    actualValue: i.actualValue,
                    checked: i.checked,
                  }))}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
