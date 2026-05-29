// StageTracker render tests (Task 7.2 / M6 checkpoint).
//
// Snapshot-style tests against canned `revision + ctx` inputs. We don't have
// react-dom/server wired into vitest yet, so instead we walk the returned
// React element tree directly and assert structure + class strings on each
// slot. This pins:
//   • The 9 slots render in STAGE_ORDER.
//   • Each slot picks the right treatment class string (active / completed /
//     blocked / future) per design §8.3.
//   • The blocked slot inlines the first gate-failure reason verbatim.
//
// The seeded BRINGUP rev is exercised as the demoable "blocked" case —
// 8 completed slots + 1 active-blocked slot + 1 (well, 0 — REVISION is the
// 9th slot, but BRINGUP is index 7 / order 8 → REVISION is the only future
// slot) with the canonical "N board(s) not yet BROUGHT_UP or QUARANTINED"
// reason inline.

import { describe, expect, test } from "vitest";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { StageTracker } from "@/components/StageTracker";
import {
  STAGE_ORDER,
  type GateContext,
  type StageName,
} from "@/lib/stages";

// ─── Helpers ───────────────────────────────────────────

function emptyCtx(stage: StageName): GateContext {
  return {
    revision: {
      id: "rev",
      currentStage: stage,
      schematicCommit: null,
      layoutCommit: null,
    },
    bomLines: [],
    artifacts: [],
    activeBuild: null,
  };
}

/**
 * Collect every <li> descendant of the returned tracker element by walking
 * the React tree. We don't render to DOM; we inspect the in-memory element
 * tree the server component produced.
 */
function findSlots(tree: ReactElement): ReactElement[] {
  const out: ReactElement[] = [];
  function walk(node: ReactNode) {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (!isValidElement(node)) return;
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === "li") {
      out.push(el);
    }
    const childProps = el.props as { children?: ReactNode };
    if (childProps.children !== undefined) {
      walk(childProps.children);
    }
  }
  walk(tree);
  return out;
}

function classOf(el: ReactElement): string {
  const props = el.props as { className?: string };
  return props.className ?? "";
}

function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textOf(props.children);
  }
  return "";
}

async function renderTracker(
  stage: StageName,
  ctx: GateContext,
): Promise<ReactElement> {
  // StageTracker is async (server component); awaiting it returns the JSX.
  const tree = await StageTracker({ revision: { currentStage: stage }, ctx });
  return tree as ReactElement;
}

// ─── Tests ─────────────────────────────────────────────

describe("StageTracker", () => {
  test("renders 9 slots in STAGE_ORDER", async () => {
    const tree = await renderTracker("REQUIREMENTS", emptyCtx("REQUIREMENTS"));
    const slots = findSlots(tree);
    expect(slots).toHaveLength(9);
    // Each slot's full label encodes the stage; check the title attribute
    // includes the stage name (verbatim from STAGE_LABELS).
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const props = slots[i]!.props as { title?: string };
      expect(props.title).toMatch(new RegExp(`^${String(i + 1).padStart(2, "0")} / `));
    }
  });

  test("active stage gets filled command-gold treatment when gate passes", async () => {
    // REQUIREMENTS gate is satisfied iff a REQUIREMENTS-stage artifact is
    // present. Pass one so the slot is "active" (not "blocked").
    const ctx = emptyCtx("REQUIREMENTS");
    ctx.artifacts = [
      {
        id: "a1",
        revisionId: "rev",
        buildId: null,
        stage: "REQUIREMENTS",
        kind: "NOTE",
        subkind: "REQUIREMENTS_DOC",
        title: "Reqs",
        fileKey: null,
        fileMime: null,
        fileBytes: null,
        noteBody: "x",
        linkUrl: null,
        createdBy: "u",
        createdAt: new Date(),
      },
    ];
    const tree = await renderTracker("REQUIREMENTS", ctx);
    const [active, ...rest] = findSlots(tree);
    expect(classOf(active!)).toContain("bg-command-gold");
    expect(classOf(active!)).toContain("text-deep-space");
    // All others are future → outlined muted.
    for (const f of rest) {
      expect(classOf(f)).toContain("border-muted");
      expect(classOf(f)).toContain("text-muted");
    }
  });

  test("blocked active slot uses outlined alert-red and inlines first reason", async () => {
    // REQUIREMENTS with no artifacts → gate fails → blocked.
    const tree = await renderTracker("REQUIREMENTS", emptyCtx("REQUIREMENTS"));
    const slots = findSlots(tree);
    const active = slots[0]!;
    expect(classOf(active)).toContain("border-alert-red");
    expect(classOf(active)).toContain("text-alert-red");
    // First reason rendered inline somewhere in the slot's text.
    const text = textOf(active);
    expect(text.toLowerCase()).toMatch(/no requirements artifact/);
  });

  test("seeded BRINGUP demo state: 8 completed slots + 1 active-blocked + 1 future", async () => {
    // Replicate the seeded-state intent without hitting the DB: build the
    // GateContext by hand to match what loadGateContext returns for the
    // seeded rev (boards ASSEMBLED, BRINGUP_LOG + BRINGUP_COMPLETE present).
    const ctx: GateContext = {
      revision: {
        id: "rev-seed",
        currentStage: "BRINGUP",
        schematicCommit: "g1ebc1cc",
        layoutCommit: "gb170ddb",
      },
      bomLines: [],
      artifacts: [],
      activeBuild: {
        id: "build-seed",
        revisionId: "rev-seed",
        label: "BUILD-001",
        boardCount: 5,
        pcbOrderRef: null,
        partsOrderRef: null,
        orderedAt: null,
        receivedAt: null,
        assemblyStartedAt: null,
        frozenAt: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "u",
        boards: Array.from({ length: 5 }, (_, i) => ({
          id: `b${i}`,
          buildId: "build-seed",
          serial: `B0${i + 1}`,
          silkscreenHash: "g1ebc1cc",
          status: "ASSEMBLED" as const,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        artifacts: [
          {
            id: "art-log",
            revisionId: null,
            buildId: "build-seed",
            stage: "BRINGUP",
            kind: "NOTE",
            subkind: "BRINGUP_LOG",
            title: "log",
            fileKey: null,
            fileMime: null,
            fileBytes: null,
            noteBody: "x",
            linkUrl: null,
            createdBy: "u",
            createdAt: new Date(),
          },
          {
            id: "art-complete",
            revisionId: null,
            buildId: "build-seed",
            stage: "BRINGUP",
            kind: "NOTE",
            subkind: "BRINGUP_COMPLETE",
            title: "complete",
            fileKey: null,
            fileMime: null,
            fileBytes: null,
            noteBody: "x",
            linkUrl: null,
            createdBy: "u",
            createdAt: new Date(),
          },
        ],
        checklists: [],
      },
    };

    const tree = await renderTracker("BRINGUP", ctx);
    const slots = findSlots(tree);
    expect(slots).toHaveLength(9);

    // Stages 0..6 (REQUIREMENTS through ASSEMBLY) → completed (outlined gold).
    for (let i = 0; i < 7; i++) {
      const cls = classOf(slots[i]!);
      expect(cls).toContain("border-command-gold");
      expect(cls).toContain("text-command-gold");
      expect(cls).not.toContain("bg-command-gold");
    }

    // Slot 7: BRINGUP, active-blocked → outlined alert-red + first reason.
    const bringup = slots[7]!;
    expect(classOf(bringup)).toContain("border-alert-red");
    expect(classOf(bringup)).toContain("text-alert-red");
    expect(textOf(bringup)).toContain(
      "5 board(s) not yet BROUGHT_UP or QUARANTINED.",
    );

    // Slot 8: REVISION, future → outlined muted.
    const future = slots[8]!;
    expect(classOf(future)).toContain("border-muted");
    expect(classOf(future)).toContain("text-muted");
  });
});
