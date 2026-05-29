// Errata pane (design §9.1 bottom-right column).
//
// Server component — renders the list of errata for a revision; per-row
// edit/delete/link interactivity lives in the sibling client component
// `ErrataItem`. The "Create erratum" button links to the full-page form at
// `/projects/[slug]/[revLabel]/errata/new` (Task 11.3).
//
// Errata are the post-freeze write path (design §5.3) — the pane stays
// fully active even when the revision is frozen. The "Create erratum"
// button is therefore NOT gated on `isFrozen`.
//
// `linkableRevisions` is the list of OTHER revisions in the same project
// (i.e., excluding this one) used as options in the per-row "Link to
// next-rev fix" dropdown. Same-project filtering happens on the parent
// (page) — this component does not re-check.
import Link from "next/link";
import type { ErratumSeverity, ErratumStatus } from "@prisma/client";
import {
  ErrataItem,
  type ErratumRowData,
  type LinkableRevisionOption,
} from "./ErrataItem";

export type ErratumInput = {
  id: string;
  title: string;
  description: string;
  severity: ErratumSeverity;
  status: ErratumStatus;
  addressedByRevisionId: string | null;
};

export function ErrataPane({
  projectSlug,
  revLabel,
  errata,
  linkableRevisions,
}: {
  projectSlug: string;
  revLabel: string;
  errata: ErratumInput[];
  linkableRevisions: LinkableRevisionOption[];
}) {
  // Build a lookup so we can render "Addressed by vN.M" with a clickable
  // href on the row level without re-querying.
  const revLabelById = new Map<string, string>();
  for (const r of linkableRevisions) revLabelById.set(r.id, r.label);

  const newErratumHref = `/projects/${projectSlug}/${encodeURIComponent(revLabel)}/errata/new`;

  return (
    <section className="border border-panel-border bg-navy-dark p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl tracking-wider text-white">
          ERRATA
        </h2>
        <Link
          href={newErratumHref}
          className="rounded border border-command-gold bg-navy-dark px-3 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space"
        >
          + Create erratum
        </Link>
      </div>

      {errata.length === 0 ? (
        <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
          NO ERRATA LOGGED.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-panel-border">
          {errata.map((e) => {
            const addressedByLabel = e.addressedByRevisionId
              ? (revLabelById.get(e.addressedByRevisionId) ?? null)
              : null;
            const addressedByHref =
              e.addressedByRevisionId && addressedByLabel
                ? `/projects/${projectSlug}/${encodeURIComponent(addressedByLabel)}`
                : null;
            const row: ErratumRowData = {
              id: e.id,
              title: e.title,
              description: e.description,
              severity: e.severity,
              status: e.status,
              addressedByRevisionId: e.addressedByRevisionId,
              addressedByLabel,
              addressedByHref,
            };
            return (
              <ErrataItem
                key={e.id}
                erratum={row}
                linkableRevisions={linkableRevisions}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
