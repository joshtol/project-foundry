// Build detail page (design §9.2).
//
// Phase 6 / M5b scope:
//   - Header strip (gold-accented if this Build is unfrozen and active).
//   - Read-only frozen timestamp; editable order refs + dates (Task 6.3).
//   - "Mark bring-up complete" button rendered as a disabled stub; wiring
//     lands in Phase 9 (M8a).
//   - Two-column grid:
//       Left (2/3): inline boards list (seeded boards exist; the real
//       per-build BoardsTable + register-board flow ships in Phase 12 / M9a).
//       Right (1/3) stacked: build artifacts (seeded NOTE/LINK rendering)
//       and a checklists pane placeholder.
//
// `[buildLabel]` is matched case-insensitively against `Build.label` per the
// functional unique index `build_revision_label_ci`. The canonical label is
// rendered from the DB row.
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  BuildAssemblyStartedAtField,
  BuildNotesField,
  BuildOrderedAtField,
  BuildPartsOrderRefField,
  BuildPcbOrderRefField,
  BuildReceivedAtField,
} from "./_header-fields";
import { ArtifactPicker } from "@/components/ArtifactPicker";
import { BoardsTable } from "@/components/BoardsTable";
import { BuildChecklistsPane } from "@/components/BuildChecklistsPane";
import { MarkBringupCompleteButton } from "@/components/MarkBringupCompleteButton";

type Params = { slug: string; revLabel: string; buildLabel: string };

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function BuildDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, revLabel, buildLabel } = await params;
  const decodedRev = decodeURIComponent(revLabel);
  const decodedBuild = decodeURIComponent(buildLabel);

  const project = await db.project.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!project) notFound();

  const revision = await db.revision.findFirst({
    where: {
      projectId: project.id,
      label: { equals: decodedRev, mode: "insensitive" },
    },
    select: { id: true, label: true, frozenAt: true, currentStage: true },
  });
  if (!revision) notFound();

  // 404 if the build label isn't attached to this revision — design §9.2
  // enforces the route's revision ↔ build relationship.
  const build = await db.build.findFirst({
    where: {
      revisionId: revision.id,
      label: { equals: decodedBuild, mode: "insensitive" },
    },
    include: {
      boards: { orderBy: { serial: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" } },
      checklists: {
        orderBy: { createdAt: "asc" },
        include: { items: { orderBy: { ordinal: "asc" } } },
      },
    },
  });
  if (!build) notFound();

  const buildIsFrozen = build.frozenAt !== null;
  const revIsFrozen = revision.frozenAt !== null;
  // Phase 1 invariant: at most one unfrozen Build per Revision. So an
  // unfrozen Build *is* the active Build — no extra lookup needed.
  const isActive = !buildIsFrozen;
  const goldAccent = isActive && !revIsFrozen;

  // "Mark bring-up complete" visibility (design §9.2): parent rev at
  // BRINGUP, this Build is active+unfrozen, no BRINGUP_COMPLETE yet.
  // Disabled state: any board's status ∉ {BROUGHT_UP, QUARANTINED}.
  const hasBringupComplete = build.artifacts.some(
    (a) => a.subkind === "BRINGUP_COMPLETE",
  );
  const showMarkComplete =
    revision.currentStage === "BRINGUP" &&
    isActive &&
    !revIsFrozen &&
    !hasBringupComplete;
  const blockingSerials = build.boards
    .filter((b) => !["BROUGHT_UP", "QUARANTINED"].includes(b.status))
    .map((b) => b.serial);
  // Edits are gated by both the Build's freeze and its parent's. We mirror
  // the assertion-helper semantics so the disabled UI matches what the
  // server would refuse anyway.
  const editsDisabled = buildIsFrozen || revIsFrozen;
  const editsDisabledReason = revIsFrozen
    ? "Revision is frozen."
    : buildIsFrozen
      ? "Build is frozen."
      : undefined;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <nav className="mb-6 font-mono text-xs uppercase tracking-wider">
        <Link
          href={`/projects/${project.slug}/${encodeURIComponent(revision.label)}`}
          className="text-signal-blue underline"
        >
          ← {project.name} / {revision.label}
        </Link>
      </nav>

      {/* Header strip — gold-accented when active+unfrozen per §9.2 */}
      <div
        className={`border border-panel-border bg-navy-dark p-6 ${
          goldAccent ? "border-l-4 border-l-command-gold" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Build
            </p>
            <h1 className="mt-1 font-display text-5xl tracking-wider text-command-gold">
              {build.label}
            </h1>
            <p className="mt-2 font-mono text-xs uppercase tracking-wider text-muted">
              {build.boardCount} boards · revision{" "}
              <Link
                href={`/projects/${project.slug}/${encodeURIComponent(revision.label)}`}
                className="text-link-muted underline"
              >
                {revision.label}
              </Link>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/*
              FROZEN badge per design §8.3 (Task 8.4): Space Mono caps,
              alert-red outlined pill on navy-dark — semantically distinct
              from the gold "ACTIVE" pill so the cascade from revision
              freeze is visible at a glance.
            */}
            <span
              className={`rounded bg-navy-dark px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${
                buildIsFrozen
                  ? "border border-alert-red text-alert-red"
                  : "border border-panel-border text-command-gold"
              }`}
            >
              {buildIsFrozen ? "FROZEN" : "ACTIVE"}
            </span>
            {/* "Mark bring-up complete" — design §9.2.
                Visibility computed above (parent rev at BRINGUP + active +
                no prior BRINGUP_COMPLETE). Enabled/disabled state computed
                from boards status + truncated tooltip per §9.2. */}
            {showMarkComplete ? (
              <MarkBringupCompleteButton
                buildId={build.id}
                blockingSerials={blockingSerials}
              />
            ) : null}
          </div>
        </div>

        {/* Editable order refs + dates (Task 6.3 inline-edit forms). */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BuildPcbOrderRefField
            id={build.id}
            value={build.pcbOrderRef}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
          <BuildPartsOrderRefField
            id={build.id}
            value={build.partsOrderRef}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
          <BuildOrderedAtField
            id={build.id}
            value={build.orderedAt}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
          <BuildReceivedAtField
            id={build.id}
            value={build.receivedAt}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
          <BuildAssemblyStartedAtField
            id={build.id}
            value={build.assemblyStartedAt}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
        </div>

        <div className="mt-6">
          <BuildNotesField
            id={build.id}
            value={build.notes}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Build frozen
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {isoDate(build.frozenAt)}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Created
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {isoDate(build.createdAt)}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Updated
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {isoDate(build.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column grid — design §9.2 */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT 2/3 — Boards (Task 12.3 / Phase 12 / M9a). */}
        <div className="space-y-6 lg:col-span-2">
          <BoardsTable
            boards={build.boards}
            buildBaseHref={`/projects/${project.slug}/${encodeURIComponent(
              revision.label,
            )}/builds/${encodeURIComponent(build.label)}`}
          />
        </div>

        {/* RIGHT 1/3 — Build artifacts + checklists */}
        <div className="space-y-6">
          <section className="border border-panel-border bg-navy-dark p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-2xl tracking-wider text-white">
                BUILD ARTIFACTS
              </h2>
              <span className="font-mono text-xs uppercase tracking-wider text-muted">
                Stage · {revision.currentStage}
              </span>
            </div>
            {build.artifacts.length === 0 ? (
              <p className="mt-4 font-mono text-sm uppercase tracking-wider text-muted">
                NO ARTIFACTS — ADD ONE BELOW.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-panel-border">
                {build.artifacts.map((a) => (
                  <li key={a.id} className="py-3 font-mono text-sm">
                    <p className="text-link-muted">{a.title}</p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
                      {a.subkind} · {a.kind} · {isoDate(a.createdAt)}
                    </p>
                    {a.linkUrl ? (
                      <a
                        href={a.linkUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block font-mono text-xs text-link-muted underline"
                      >
                        {a.linkUrl}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {/* Add-artifact picker (design §9.2) — scoped to the parent
                revision's current stage's buildAllowedArtifactSubkinds.
                BRINGUP_COMPLETE is never in the picker — design §9.2. */}
            {!editsDisabled ? (
              <div className="mt-6 border-t border-panel-border pt-6">
                <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">
                  Add artifact
                </p>
                <ArtifactPicker
                  owner={{ kind: "build", id: build.id }}
                  stage={revision.currentStage}
                />
              </div>
            ) : null}
          </section>

          <BuildChecklistsPane
            buildId={build.id}
            checklists={build.checklists}
            stage={revision.currentStage}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
        </div>
      </div>
    </main>
  );
}
