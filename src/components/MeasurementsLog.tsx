// Measurements log (Task 14.2 / design §9.3 left column 2/3 width).
//
// Server component — renders the per-Board measurement log grouped first
// by `stage` (in canonical STAGE_ORDER) then by `step` (insertion order).
// Each row shows step | expected | actual | unit | result pill | when | who.
//
// Result pill colors per design §8.3:
//   PASS     → status-green text on navy-dark chip
//   FAIL     → alert-red text, filled chip
//   OBSERVED → muted text
//   PEND     → muted text
//
// Top of the pane: single-row "Add measurement" + "Bulk add (tab-paste)"
// modal trigger. Both are gated by `disabled` when the parent revision
// or Build is frozen — the server backs that up with assertion-helper
// guards (see lib/actions/measurements.ts).
import type { MeasurementResult, Stage } from "@prisma/client";
import { AddMeasurementForm } from "./AddMeasurementForm";
import { BulkMeasurementsDialog } from "./BulkMeasurementsDialog";
import { STAGE_ORDER } from "@/lib/stages";

export type MeasurementRow = {
  id: string;
  stage: Stage;
  step: string;
  expectedValue: string | null;
  actualValue: string;
  unit: string | null;
  result: MeasurementResult;
  notes: string | null;
  measuredAt: Date;
  measuredBy: { name: string | null; email: string };
};

function resultPillClasses(result: MeasurementResult): string {
  const base =
    "inline-block rounded border bg-navy-dark px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider";
  switch (result) {
    case "PASS":
      return `${base} border-status-green text-status-green`;
    case "FAIL":
      // Filled per design §8.3 for high-attention rows.
      return "inline-block rounded border border-alert-red bg-alert-red px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-deep-space";
    case "OBSERVED":
      return `${base} border-panel-border text-muted`;
    case "PEND":
      return `${base} border-panel-border text-muted`;
  }
}

function isoTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function whoLabel(by: { name: string | null; email: string }): string {
  return by.name ?? by.email;
}

export function MeasurementsLog({
  boardId,
  measurements,
  defaultStage,
  disabled,
  disabledReason,
}: {
  boardId: string;
  measurements: MeasurementRow[];
  defaultStage: Stage;
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Group by (stage, step). Stages come back in canonical STAGE_ORDER so the
  // log reads top-to-bottom in workflow order; within a stage, steps are
  // grouped together and rendered in measuredAt-ascending order.
  const byStage = new Map<Stage, Map<string, MeasurementRow[]>>();
  for (const m of measurements) {
    let stepBucket = byStage.get(m.stage);
    if (!stepBucket) {
      stepBucket = new Map();
      byStage.set(m.stage, stepBucket);
    }
    let rows = stepBucket.get(m.step);
    if (!rows) {
      rows = [];
      stepBucket.set(m.step, rows);
    }
    rows.push(m);
  }
  // Stable insertion order within step → measuredAt ascending so the log
  // reads as a tape of readings.
  for (const stepBucket of byStage.values()) {
    for (const rows of stepBucket.values()) {
      rows.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
    }
  }

  const stagesPresent = STAGE_ORDER.filter((s) => byStage.has(s as Stage));

  return (
    <section className="border border-panel-border bg-navy-dark p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl tracking-wider text-white">
          MEASUREMENTS
        </h2>
        <BulkMeasurementsDialog
          boardId={boardId}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </div>

      {/* Single-row entry */}
      <div className="mt-4 border-b border-panel-border pb-6">
        <AddMeasurementForm
          boardId={boardId}
          defaultStage={defaultStage}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </div>

      {measurements.length === 0 ? (
        <p className="mt-6 font-mono text-sm uppercase tracking-wider text-muted">
          NO MEASUREMENTS — ADD ONE ABOVE.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {stagesPresent.map((stage) => {
            const stepBucket = byStage.get(stage as Stage)!;
            const steps = Array.from(stepBucket.keys()).sort();
            return (
              <div key={stage}>
                <h3 className="font-mono text-xs uppercase tracking-wider text-command-gold">
                  {stage}
                </h3>
                <div className="mt-2 space-y-4">
                  {steps.map((step) => {
                    const rows = stepBucket.get(step)!;
                    return (
                      <div key={step}>
                        <p className="font-mono text-xs uppercase tracking-wider text-link-muted">
                          {step}
                        </p>
                        <div className="mt-1 overflow-x-auto">
                          <table className="w-full font-mono text-xs text-link-muted">
                            <thead>
                              <tr className="border-b border-panel-border text-muted">
                                <th className="px-1 py-1 text-left">expected</th>
                                <th className="px-1 py-1 text-left">actual</th>
                                <th className="px-1 py-1 text-left">unit</th>
                                <th className="px-1 py-1 text-left">result</th>
                                <th className="px-1 py-1 text-left">when</th>
                                <th className="px-1 py-1 text-left">who</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr
                                  key={r.id}
                                  className="border-b border-panel-border/40"
                                >
                                  <td className="px-1 py-1">{r.expectedValue ?? "—"}</td>
                                  <td className="px-1 py-1 text-link-muted">{r.actualValue}</td>
                                  <td className="px-1 py-1">{r.unit ?? "—"}</td>
                                  <td className="px-1 py-1">
                                    <span className={resultPillClasses(r.result)}>
                                      {r.result}
                                    </span>
                                  </td>
                                  <td className="px-1 py-1">{isoTime(r.measuredAt)}</td>
                                  <td className="px-1 py-1">
                                    {whoLabel(r.measuredBy)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
