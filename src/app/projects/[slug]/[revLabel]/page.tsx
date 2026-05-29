// Revision detail page (design §9.1).
//
// Phase 5a scope: the header strip (with read-only commit-SHA placeholders;
// edit forms land in Task 5.3), a read-only stage tracker stub (no gate
// reasoning until Phase 7), and the two-column grid with placeholder
// Builds/Artifacts panes and a real transitions log. BomLine + Build CRUD
// and the rest of the panes land in 5.4/5.5 and Phase 6+.
//
// `[revLabel]` is matched case-insensitively against `Revision.label`
// (per the functional unique index `revision_project_label_ci`); the
// canonical label is rendered from the DB row.
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { STAGE_LABELS, STAGE_ORDER, type StageName } from "@/lib/stages";
import { TransitionsLog } from "@/components/TransitionsLog";

type Params = { slug: string; revLabel: string };

export default async function RevisionDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, revLabel } = await params;
  const decodedLabel = decodeURIComponent(revLabel);

  const project = await db.project.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!project) notFound();

  const revision = await db.revision.findFirst({
    where: {
      projectId: project.id,
      label: { equals: decodedLabel, mode: "insensitive" },
    },
    include: {
      bomLines: {
        include: { part: true },
        orderBy: { createdAt: "asc" },
      },
      artifacts: { orderBy: { createdAt: "desc" } },
      transitions: {
        include: { user: { select: { email: true, name: true } } },
        orderBy: { transitionedAt: "desc" },
      },
      errata: { orderBy: { createdAt: "desc" } },
      builds: {
        orderBy: [{ frozenAt: "asc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!revision) notFound();

  const isFrozen = revision.frozenAt !== null;
  const currentIdx = STAGE_ORDER.indexOf(revision.currentStage as StageName);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <nav className="mb-6 font-mono text-xs uppercase tracking-wider">
        <Link href={`/projects/${project.slug}`} className="text-signal-blue underline">
          ← {project.name}
        </Link>
      </nav>

      {/* Header strip — gold-accented per §9.1 when unfrozen */}
      <div
        className={`border border-panel-border bg-navy-dark p-6 ${
          isFrozen ? "" : "border-l-4 border-l-command-gold"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Revision
            </p>
            <h1 className="mt-1 font-display text-5xl tracking-wider text-command-gold">
              {revision.label}
            </h1>
          </div>
          <span className="rounded border border-panel-border bg-navy-dark px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-command-gold">
            {revision.currentStage}
          </span>
        </div>

        {/* Commit-SHA inputs land in Task 5.3 — placeholders for now */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Schematic commit
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {revision.schematicCommit ?? "—"}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Layout commit
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {revision.layoutCommit ?? "—"}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              BOM frozen
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {revision.bomFrozenAt
                ? revision.bomFrozenAt.toISOString().slice(0, 10)
                : "—"}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Revision frozen
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {revision.frozenAt
                ? revision.frozenAt.toISOString().slice(0, 10)
                : "—"}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Updated
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {revision.updatedAt.toISOString().slice(0, 10)}
            </p>
          </div>
        </div>
      </div>

      {/* Stage tracker stub — read-only; Phase 7 wires gate state */}
      <div className="mt-6 overflow-x-auto border border-panel-border bg-navy-dark p-4">
        <ol className="flex min-w-max items-stretch gap-2">
          {STAGE_ORDER.map((stage, idx) => {
            const isActive = idx === currentIdx;
            const isCompleted = idx < currentIdx;
            const cls = isActive
              ? "border-command-gold bg-command-gold text-deep-space"
              : isCompleted
                ? "border-command-gold text-command-gold"
                : "border-panel-border text-muted";
            return (
              <li
                key={stage}
                className={`min-w-[110px] rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider ${cls}`}
              >
                <span className="block">
                  {String(idx + 1).padStart(2, "0")} / {STAGE_LABELS[stage]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Two-column grid — design §9.1 */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT 2/3 — Builds + Artifacts */}
        <div className="space-y-6 lg:col-span-2">
          {/* Builds pane */}
          <section className="border border-panel-border bg-navy-dark p-6">
            <h2 className="font-display text-2xl tracking-wider text-white">
              BUILDS
            </h2>
            {revision.builds.length === 0 ? (
              <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
                NO BUILDS YET.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-panel-border">
                {revision.builds.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-baseline justify-between gap-4 py-3 font-mono text-sm"
                  >
                    <span className="text-command-gold">{b.label}</span>
                    <span className="text-muted">
                      {b.boardCount} boards ·{" "}
                      {b.frozenAt ? "frozen" : "active"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Artifacts pane (stage filter is a stub for Phase 5a) */}
          <section className="border border-panel-border bg-navy-dark p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-2xl tracking-wider text-white">
                ARTIFACTS
              </h2>
              {/* Stage selector stub — wired in Phase 8 */}
              <span className="font-mono text-xs uppercase tracking-wider text-muted">
                Stage · {revision.currentStage}
              </span>
            </div>
            <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
              NO ARTIFACTS AT THIS STAGE.
            </p>
          </section>
        </div>

        {/* RIGHT 1/3 — Transitions + Errata */}
        <div className="space-y-6">
          <section className="border border-panel-border bg-navy-dark p-6">
            <h2 className="font-display text-2xl tracking-wider text-white">
              TRANSITIONS
            </h2>
            <div className="mt-4">
              <TransitionsLog transitions={revision.transitions} />
            </div>
          </section>

          <section className="border border-panel-border bg-navy-dark p-6">
            <h2 className="font-display text-2xl tracking-wider text-white">
              ERRATA
            </h2>
            {revision.errata.length === 0 ? (
              <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
                NO ERRATA.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-panel-border">
                {revision.errata.map((e) => (
                  <li key={e.id} className="py-3 font-mono text-sm">
                    <p className="text-link-muted">{e.title}</p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
                      {e.severity} · {e.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
