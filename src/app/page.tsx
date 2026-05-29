// Project list page. Default shows only un-archived projects; `?archived=1`
// includes archived rows too. Manifest-style table per design §8.3 / §9 —
// Bebas Neue title, Space Mono columns, command-gold project names.
//
// Server component: data fetched directly via Prisma. searchParams is async
// in Next.js 16 (must be awaited).
//
// Polish §15.4: each row shows its current-state — latest revision label +
// its currentStage as a navy-dark chip pill (command-gold for the active
// stage). Sorting is by last-activity (max of project.updatedAt and the
// most-recent revision.updatedAt) so freshly-touched work surfaces first.
import Link from "next/link";
import { db } from "@/lib/db";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const params = await searchParams;
  const showArchived = params.archived === "1";

  const projects = await db.project.findMany({
    where: showArchived ? {} : { archivedAt: null },
    include: {
      revisions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { label: true, currentStage: true, updatedAt: true },
      },
    },
  });

  // Compute last-activity as max(project.updatedAt, latestRevision.updatedAt)
  // and sort descending — most-recently-touched first. Prisma's `orderBy`
  // can't reach into the included relation, so the sort runs in memory.
  const sorted = projects
    .map((p) => {
      const latest = p.revisions[0] ?? null;
      const lastActivity = latest
        ? p.updatedAt.getTime() > latest.updatedAt.getTime()
          ? p.updatedAt
          : latest.updatedAt
        : p.updatedAt;
      return { ...p, latest, lastActivity };
    })
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-5xl tracking-wider text-white">
          PROJECT FOUNDRY
        </h1>
        <div className="flex items-center gap-4 font-mono text-xs uppercase">
          <Link
            href={showArchived ? "/" : "/?archived=1"}
            className="text-signal-blue underline"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Link
            href="/projects/new"
            className="rounded border border-panel-border bg-navy-dark px-4 py-2 text-command-gold transition-colors hover:border-command-gold"
          >
            + New project
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-10 font-mono text-sm uppercase tracking-wider text-muted">
          NO PROJECTS — CREATE ONE TO BEGIN.
        </p>
      ) : (
        <table className="mt-10 w-full border-collapse font-mono text-sm">
          <thead>
            <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-3 pr-4 font-normal">Name</th>
              {/* Slug + Updated hidden at < md (Task 15.5 responsive pass). */}
              <th className="hidden py-3 pr-4 font-normal md:table-cell">
                Slug
              </th>
              <th className="hidden py-3 pr-4 font-normal md:table-cell">
                Updated
              </th>
              <th className="py-3 pr-4 font-normal">Current state</th>
              <th className="py-3 pr-4 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.id}
                className="border-b border-panel-border align-top"
              >
                <td className="py-3 pr-4">
                  <Link
                    href={`/projects/${p.slug}`}
                    className="text-command-gold hover:underline"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="hidden py-3 pr-4 text-muted md:table-cell">
                  {p.slug}
                </td>
                <td className="hidden py-3 pr-4 text-muted md:table-cell">
                  {p.lastActivity.toISOString().slice(0, 10)}
                </td>
                <td className="py-3 pr-4">
                  {p.latest ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projects/${p.slug}/${encodeURIComponent(p.latest.label)}`}
                        className="text-link-muted underline-offset-2 hover:underline"
                      >
                        {p.latest.label}
                      </Link>
                      {/*
                        Stage pill — Space Mono caps on a navy-dark chip with
                        command-gold text + 1px panel-border per §8.3 pill
                        anatomy. Mirrors the active-stage treatment used in
                        the revision header strip.
                      */}
                      <span className="inline-block rounded border border-panel-border bg-navy-dark px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-command-gold">
                        {p.latest.currentStage}
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono text-xs uppercase tracking-wider text-muted">
                      NO REVISIONS
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-muted">
                  {p.archivedAt ? "ARCHIVED" : "ACTIVE"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
