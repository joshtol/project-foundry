// Board detail page (design §9.3).
//
// Phase 12 / M9a scope:
//   - Header strip: build label + board serial; editable silkscreenHash,
//     status dropdown (all 7 BoardStatus values), notes textarea. Inline
//     edits call editBoard; subject to assertBuildNotFrozen +
//     assertNotFrozen on the server.
//   - Two-column grid:
//       Left (2/3): Measurements log placeholder — Phase 14 / M9c.
//       Right (1/3): Board checklists placeholder — Phase 13 / M9b.
//
// 404 if the board isn't on this build / rev / project triple. Mirrors the
// Build detail page's revision↔build coupling for route safety.
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  BoardNotesField,
  BoardSilkscreenHashField,
  BoardStatusField,
} from "./_header-fields";

type Params = {
  slug: string;
  revLabel: string;
  buildLabel: string;
  serial: string;
};

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function BoardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, revLabel, buildLabel, serial } = await params;
  const decodedRev = decodeURIComponent(revLabel);
  const decodedBuild = decodeURIComponent(buildLabel);
  const decodedSerial = decodeURIComponent(serial);

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
    select: { id: true, label: true, frozenAt: true },
  });
  if (!revision) notFound();

  const build = await db.build.findFirst({
    where: {
      revisionId: revision.id,
      label: { equals: decodedBuild, mode: "insensitive" },
    },
    select: { id: true, label: true, frozenAt: true },
  });
  if (!build) notFound();

  const board = await db.board.findFirst({
    where: {
      buildId: build.id,
      serial: { equals: decodedSerial, mode: "insensitive" },
    },
    select: {
      id: true,
      serial: true,
      silkscreenHash: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!board) notFound();

  const revIsFrozen = revision.frozenAt !== null;
  const buildIsFrozen = build.frozenAt !== null;
  const editsDisabled = revIsFrozen || buildIsFrozen;
  const editsDisabledReason = revIsFrozen
    ? "Revision is frozen."
    : buildIsFrozen
      ? "Build is frozen."
      : undefined;

  const buildHref = `/projects/${project.slug}/${encodeURIComponent(
    revision.label,
  )}/builds/${encodeURIComponent(build.label)}`;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <nav className="mb-6 font-mono text-xs uppercase tracking-wider">
        <Link href={buildHref} className="text-signal-blue underline">
          ← {project.name} / {revision.label} / {build.label}
        </Link>
      </nav>

      {/* Header strip — design §9.3 */}
      <div className="border border-panel-border bg-navy-dark p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Board · {build.label}
            </p>
            <h1 className="mt-1 flex items-baseline gap-4 font-display text-5xl tracking-wider text-command-gold">
              {board.serial}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={`rounded bg-navy-dark px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${
                buildIsFrozen
                  ? "border border-alert-red text-alert-red"
                  : "border border-panel-border text-command-gold"
              }`}
            >
              {buildIsFrozen ? "FROZEN" : "ACTIVE"}
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <BoardSilkscreenHashField
            id={board.id}
            value={board.silkscreenHash}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
          <BoardStatusField
            id={board.id}
            value={board.status}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
        </div>

        <div className="mt-6">
          <BoardNotesField
            id={board.id}
            value={board.notes}
            disabled={editsDisabled}
            disabledReason={editsDisabledReason}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Created
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {isoDate(board.createdAt)}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Updated
            </p>
            <p className="mt-1 font-mono text-sm text-link-muted">
              {isoDate(board.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column grid — design §9.3 */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT 2/3 — Measurements log (Phase 14 / M9c) */}
        <div className="space-y-6 lg:col-span-2">
          <section className="border border-panel-border bg-navy-dark p-6">
            <h2 className="font-display text-2xl tracking-wider text-white">
              MEASUREMENTS
            </h2>
            <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
              NO MEASUREMENTS YET.
            </p>
          </section>
        </div>

        {/* RIGHT 1/3 — Board checklists (Phase 13 / M9b) */}
        <div className="space-y-6">
          <section className="border border-panel-border bg-navy-dark p-6">
            <h2 className="font-display text-2xl tracking-wider text-white">
              BOARD CHECKLISTS
            </h2>
            <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
              NO CHECKLISTS YET.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
