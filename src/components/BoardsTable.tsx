// BoardsTable — design §9.2 / §8.3.
//
// Server component. Renders the per-Build boards list with status pills
// styled per §8.3. The component itself is read-only; row-level edits
// happen on the Board detail page reached by clicking the row.
//
// §8.3 pill rules:
//   - All pills sit on a navy-dark chip background (defeats command-gold
//     vs status-green ~1.12:1 invisibility inside gold-accented panels).
//   - BARE / SCREENED       → text-muted + panel-border
//   - ASSEMBLED / POWERED   → text-command-gold + panel-border (in-flight)
//   - BROUGHT_UP            → text-status-green + panel-border (terminal pass)
//   - FAILED                → text-alert-red + panel-border (filled-red text)
//   - QUARANTINED           → text-muted + border-alert-red
//     (outlined-red border + muted text — semantically "removed, not
//      actively a problem"; visually distinct from FAILED's red text)
import Link from "next/link";
import type { Board, BoardStatus } from "@prisma/client";

type StatusPillTone = {
  text: string;
  border: string;
};

const STATUS_TONE: Record<BoardStatus, StatusPillTone> = {
  BARE: { text: "text-muted", border: "border-panel-border" },
  SCREENED: { text: "text-muted", border: "border-panel-border" },
  ASSEMBLED: { text: "text-command-gold", border: "border-panel-border" },
  POWERED: { text: "text-command-gold", border: "border-panel-border" },
  BROUGHT_UP: { text: "text-status-green", border: "border-panel-border" },
  FAILED: { text: "text-alert-red", border: "border-panel-border" },
  QUARANTINED: { text: "text-muted", border: "border-alert-red" },
};

function StatusPill({ status }: { status: BoardStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-block rounded border bg-navy-dark px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${tone.text} ${tone.border}`}
    >
      {status}
    </span>
  );
}

function truncateHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  // Convention: display the first 7 chars (git short-hash equivalent).
  // The leading 'g' (if present) is the git-describe prefix, not part of
  // the SHA — strip it before slicing so the short-hash is the actual SHA
  // prefix.
  const sha = hash.startsWith("g") ? hash.slice(1) : hash;
  return sha.slice(0, 7);
}

function formatLastTouched(d: Date): string {
  // YYYY-MM-DD HH:mm (UTC-equivalent ISO slice). Avoids locale drift across
  // server/client rendering.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function BoardsTable({
  boards,
  buildBaseHref,
}: {
  boards: Pick<Board, "id" | "serial" | "silkscreenHash" | "status" | "updatedAt">[];
  /**
   * The Build detail URL path (without trailing slash). Used to build the
   * /boards/new and /boards/[serial] hrefs for each row + the header
   * Register-board CTA.
   */
  buildBaseHref: string;
}) {
  return (
    <section className="border border-panel-border bg-navy-dark p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl tracking-wider text-white">
          BOARDS
        </h2>
        <Link
          href={`${buildBaseHref}/boards/new`}
          className="rounded border border-command-gold bg-navy-dark px-4 py-1 font-mono text-xs uppercase tracking-wider text-command-gold transition-colors hover:bg-command-gold hover:text-deep-space"
        >
          Register board
        </Link>
      </div>

      {boards.length === 0 ? (
        <p className="mt-4 font-mono text-sm uppercase tracking-wider text-muted">
          NO BOARDS — REGISTER ONE TO BEGIN.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-2 pr-3 font-normal">Serial</th>
                {/* Silkscreen + last-touched hidden at < md per Task 15.5. */}
                <th className="hidden py-2 pr-3 font-normal md:table-cell">
                  Silkscreen
                </th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="hidden py-2 font-normal md:table-cell">
                  Last touched
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-panel-border">
              {boards.map((b) => (
                <tr key={b.id} className="group">
                  <td className="py-3 pr-3">
                    <Link
                      href={`${buildBaseHref}/boards/${encodeURIComponent(b.serial)}`}
                      className="text-command-gold underline-offset-2 group-hover:underline"
                    >
                      {b.serial}
                    </Link>
                  </td>
                  <td className="hidden py-3 pr-3 text-muted md:table-cell">
                    {truncateHash(b.silkscreenHash)}
                  </td>
                  <td className="py-3 pr-3">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="hidden py-3 text-muted md:table-cell">
                    {formatLastTouched(b.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
