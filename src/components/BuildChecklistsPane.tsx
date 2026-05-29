// Build-scoped Checklists pane (Task 13.2 / design §9.2 right column bottom).
//
// Server component — renders the list of Build-scoped checklists with
// per-row title + subkind tag + item count + completion percentage; the
// "+ New checklist" button opens a modal (NewChecklistDialog) with subkind
// options restricted to the Build-scope subkinds per §9.2:
//   EQUIPMENT_PREFLIGHT | POST_ASSEMBLY_CONTINUITY | POLARITY_VERIFICATION | GENERIC
//
// Each row expands inline to the ChecklistEditor (client component) so the
// user can add/edit/reorder/tick items without leaving the Build page.
//
// Freeze guard: when the parent rev or Build is frozen, the dialog and the
// editor render in disabled mode — the server still backs that up with the
// freeze assertions on every mutation.
import type {
  ChecklistSubkind,
  Stage,
  Checklist,
  ChecklistItem,
} from "@prisma/client";
import { ChecklistEditor } from "./ChecklistEditor";
import { NewChecklistDialog } from "./NewChecklistDialog";

const BUILD_SUBKINDS: ChecklistSubkind[] = [
  "EQUIPMENT_PREFLIGHT",
  "POST_ASSEMBLY_CONTINUITY",
  "POLARITY_VERIFICATION",
  "GENERIC",
];

export type BuildChecklistInput = Checklist & {
  items: ChecklistItem[];
};

function checklistSubkindPillClasses(subkind: ChecklistSubkind): string {
  const base =
    "inline-block rounded border bg-navy-dark px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider";
  // POST_ASSEMBLY_CONTINUITY is gate-relevant — emphasise with command-gold.
  if (subkind === "POST_ASSEMBLY_CONTINUITY") {
    return `${base} border-command-gold text-command-gold`;
  }
  return `${base} border-panel-border text-link-muted`;
}

export function BuildChecklistsPane({
  buildId,
  checklists,
  stage,
  disabled,
  disabledReason,
}: {
  buildId: string;
  checklists: BuildChecklistInput[];
  stage: Stage;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <section className="border border-panel-border bg-navy-dark p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl tracking-wider text-white">
          BUILD CHECKLISTS
        </h2>
        <NewChecklistDialog
          ownerKind="build"
          ownerId={buildId}
          stage={stage}
          allowedSubkinds={BUILD_SUBKINDS}
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
