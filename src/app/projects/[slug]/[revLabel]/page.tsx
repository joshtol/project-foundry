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
import { type StageName } from "@/lib/stages";
import { loadGateContext } from "@/lib/load-gate-context";
import { StageTracker } from "@/components/StageTracker";
import { TransitionsLog } from "@/components/TransitionsLog";
import {
  EditLayoutCommitForm,
  EditSchematicCommitForm,
} from "./_commit-fields";
import { BomEditor } from "./_bom-editor";

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

  // Gate context for the StageTracker (Phase 7). Loaded server-side so the
  // tracker stays a pure render; same loader the advanceStage action will
  // reuse inside its Serializable tx in Phase 8.
  const gateCtx = await loadGateContext(db, revision.id);

  // "Create new Build" gating (design §9.1): mirror createBuild's stage
  // assertion AND the Phase 1 one-unfrozen-Build-per-revision invariant.
  // Hiding the button when it would be rejected anyway keeps the affordance
  // honest.
  const buildCreatableStages: StageName[] = [
    "DRC_GERBER",
    "ORDERING",
    "ASSEMBLY",
    "BRINGUP",
  ];
  const hasUnfrozenBuild = revision.builds.some((b) => b.frozenAt === null);
  const canCreateBuild =
    !isFrozen &&
    buildCreatableStages.includes(revision.currentStage as StageName) &&
    !hasUnfrozenBuild;

  // Parts list for the BomEditor dropdown — capped at 200 for Phase 5a;
  // search/pagination lands when the parts library grows past that. The
  // global parts library is shared across projects per design §4.3.
  const parts =
    revision.currentStage === "BOM_SOURCING"
      ? await db.part.findMany({
          orderBy: [{ manufacturer: "asc" }, { mpn: "asc" }],
          take: 200,
          select: { id: true, mpn: true, manufacturer: true },
        })
      : [];

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

        {/* Commit-SHA inline-edit (Task 5.3) — disabled when frozen */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <EditSchematicCommitForm
            revisionId={revision.id}
            value={revision.schematicCommit}
            disabled={isFrozen}
          />
          <EditLayoutCommitForm
            revisionId={revision.id}
            value={revision.layoutCommit}
            disabled={isFrozen}
          />
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

      {/* Stage tracker — read-only; gates evaluated server-side (Phase 7) */}
      <div className="mt-6">
        <StageTracker
          revision={{ currentStage: revision.currentStage }}
          ctx={gateCtx}
        />
      </div>

      {/* Two-column grid — design §9.1 */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT 2/3 — Builds + Artifacts */}
        <div className="space-y-6 lg:col-span-2">
          {/* Builds pane — design §9.1 */}
          <section className="border border-panel-border bg-navy-dark p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl tracking-wider text-white">
                BUILDS
              </h2>
              {/*
                "Create new Build" visibility (design §9.1): revision in
                DRC_GERBER/ORDERING/ASSEMBLY/BRINGUP, unfrozen, AND no unfrozen
                Build exists. Matches the createBuild action's gates so the
                user never sees the deeper error.
              */}
              {canCreateBuild ? (
                <Link
                  href={`/projects/${project.slug}/${encodeURIComponent(revision.label)}/builds/new`}
                  className="rounded border border-command-gold bg-navy-dark px-3 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space"
                >
                  + New build
                </Link>
              ) : null}
            </div>
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
                    <Link
                      href={`/projects/${project.slug}/${encodeURIComponent(revision.label)}/builds/${encodeURIComponent(b.label)}`}
                      className="text-command-gold underline-offset-4 hover:underline"
                    >
                      {b.label}
                    </Link>
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

            {/* BomLine editor — visible only in BOM_SOURCING (design §9.1). */}
            {revision.currentStage === "BOM_SOURCING" ? (
              <div className="mt-4">
                <BomEditor
                  revisionId={revision.id}
                  lines={revision.bomLines.map((l) => ({
                    id: l.id,
                    refDes: l.refDes,
                    quantity: l.quantity,
                    notes: l.notes,
                    part: {
                      id: l.part.id,
                      mpn: l.part.mpn,
                      manufacturer: l.part.manufacturer,
                    },
                  }))}
                  parts={parts.map((p) => ({
                    id: p.id,
                    mpn: p.mpn,
                    manufacturer: p.manufacturer,
                  }))}
                  disabled={isFrozen || revision.bomFrozenAt !== null}
                  disabledReason={
                    isFrozen
                      ? "Revision is frozen."
                      : revision.bomFrozenAt !== null
                        ? "BOM is frozen."
                        : undefined
                  }
                />
              </div>
            ) : (
              <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
                NO ARTIFACTS AT THIS STAGE.
              </p>
            )}
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
