// TransitionsLog render tests (Task 8.5 / design §9.1).
//
// One fixture per direction kind (init / advance / regress). Verifies the
// rendered text matches §9.1's rules:
//   - INIT     → "Revision created"
//   - ADVANCE  → "Advanced: {fromStage} → {toStage}"
//   - REGRESS  → "{fromStage} → {toStage}: {reason}"
//
// Also verifies reverse-chronological ordering and the multi-stage
// skip-regress case (e.g., BRINGUP → ORDERING from createBuild).
//
// Same tree-walk pattern used by StageTracker.test.tsx — we don't render
// to DOM, we inspect the in-memory React element tree.

import { describe, expect, test } from "vitest";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { TransitionsLog } from "@/components/TransitionsLog";

type TransitionRow = Parameters<typeof TransitionsLog>[0]["transitions"][number];

function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    // Function components are React elements whose `type` is a function;
    // we call it with its props to obtain its rendered tree. This is the
    // server-side rendering shape — no hooks fire because our render
    // helpers are pure.
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === "function") {
      const Comp = el.type as (props: Record<string, unknown>) => ReactNode;
      return textOf(Comp(el.props as Record<string, unknown>));
    }
    return textOf(el.props.children);
  }
  return "";
}

function findRows(tree: ReactElement): ReactElement[] {
  const out: ReactElement[] = [];
  function walk(node: ReactNode) {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (!isValidElement(node)) return;
    const el = node as ReactElement;
    if (el.type === "li") out.push(el);
    const props = el.props as { children?: ReactNode };
    if (props.children !== undefined) walk(props.children);
  }
  walk(tree);
  return out;
}

const seedUser = { email: "seed@example.com", name: "Seed User" };

function makeRow(over: Partial<TransitionRow>): TransitionRow {
  return {
    id: over.id ?? "row-" + Math.random().toString(36).slice(2),
    direction: over.direction ?? "ADVANCE",
    fromStage: over.fromStage ?? null,
    toStage: over.toStage ?? "REQUIREMENTS",
    transitionedAt: over.transitionedAt ?? new Date("2026-05-28T12:00:00Z"),
    notes: over.notes ?? null,
    user: over.user ?? seedUser,
  };
}

describe("TransitionsLog", () => {
  test("INIT row renders 'Revision created'", () => {
    const tree = TransitionsLog({
      transitions: [
        makeRow({
          id: "init",
          direction: "INIT",
          fromStage: null,
          toStage: "REQUIREMENTS",
        }),
      ],
    });
    const rows = findRows(tree as ReactElement);
    expect(rows).toHaveLength(1);
    const text = textOf(rows[0]!);
    expect(text).toContain("Revision created");
    expect(text).toContain("2026-05-28");
    expect(text).toContain("Seed User");
  });

  test("ADVANCE row renders 'Advanced: {from} → {to}'", () => {
    const tree = TransitionsLog({
      transitions: [
        makeRow({
          id: "adv",
          direction: "ADVANCE",
          fromStage: "REQUIREMENTS",
          toStage: "SCHEMATIC",
        }),
      ],
    });
    const rows = findRows(tree as ReactElement);
    expect(rows).toHaveLength(1);
    const text = textOf(rows[0]!);
    expect(text).toMatch(/Advanced:\s*REQUIREMENTS\s*→\s*SCHEMATIC/);
  });

  test("REGRESS row renders '{from} → {to}: {reason}' with the reason", () => {
    const tree = TransitionsLog({
      transitions: [
        makeRow({
          id: "reg",
          direction: "REGRESS",
          fromStage: "LAYOUT",
          toStage: "BOM_SOURCING",
          notes: "BOM mistake; need to swap a part.",
        }),
      ],
    });
    const rows = findRows(tree as ReactElement);
    expect(rows).toHaveLength(1);
    const text = textOf(rows[0]!);
    expect(text).toMatch(
      /LAYOUT\s*→\s*BOM_SOURCING:\s*BOM mistake; need to swap a part\./,
    );
  });

  test("multi-stage skip-regress (BRINGUP → ORDERING from createBuild) renders naturally", () => {
    const tree = TransitionsLog({
      transitions: [
        makeRow({
          id: "skip",
          direction: "REGRESS",
          fromStage: "BRINGUP",
          toStage: "ORDERING",
          notes: "New Build BUILD-002 created",
        }),
      ],
    });
    const rows = findRows(tree as ReactElement);
    const text = textOf(rows[0]!);
    expect(text).toMatch(
      /BRINGUP\s*→\s*ORDERING:\s*New Build BUILD-002 created/,
    );
  });

  test("rows render in reverse-chronological order", () => {
    const tree = TransitionsLog({
      transitions: [
        makeRow({
          id: "old",
          direction: "INIT",
          transitionedAt: new Date("2026-01-01T00:00:00Z"),
        }),
        makeRow({
          id: "new",
          direction: "ADVANCE",
          fromStage: "REQUIREMENTS",
          toStage: "SCHEMATIC",
          transitionedAt: new Date("2026-05-01T00:00:00Z"),
        }),
        makeRow({
          id: "mid",
          direction: "ADVANCE",
          fromStage: "SCHEMATIC",
          toStage: "BOM_SOURCING",
          transitionedAt: new Date("2026-03-01T00:00:00Z"),
        }),
      ],
    });
    const rows = findRows(tree as ReactElement);
    expect(rows).toHaveLength(3);
    // First row should be the newest; last row should be the oldest.
    expect(textOf(rows[0]!)).toContain("REQUIREMENTS");
    expect(textOf(rows[0]!)).toContain("SCHEMATIC");
    expect(textOf(rows[2]!)).toContain("Revision created");
  });

  test("empty list renders placeholder", () => {
    const tree = TransitionsLog({ transitions: [] });
    const text = textOf(tree as ReactNode);
    expect(text).toMatch(/NO TRANSITIONS — ADVANCE THE STAGE TO BEGIN\./);
  });
});
