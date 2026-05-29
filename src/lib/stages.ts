// Stage ordering stub (Phase 5a). Replaced by Phase 7 with the full STAGES
// record (per design §5.2) including gate functions, allowed artifact
// subkinds, and entry hints. For now the array is enough to drive the
// read-only stage tracker on the revision detail page.
import { Stage } from "@prisma/client";

export const STAGE_ORDER = [
  "REQUIREMENTS",
  "SCHEMATIC",
  "BOM_SOURCING",
  "LAYOUT",
  "DRC_GERBER",
  "ORDERING",
  "ASSEMBLY",
  "BRINGUP",
  "REVISION",
] as const satisfies readonly Stage[];

export type StageName = (typeof STAGE_ORDER)[number];

// Compact display labels for §8.3 stage tracker slots.
export const STAGE_LABELS: Record<StageName, string> = {
  REQUIREMENTS: "REQUIREMENTS",
  SCHEMATIC: "SCHEMATIC",
  BOM_SOURCING: "BOM SOURCING",
  LAYOUT: "LAYOUT",
  DRC_GERBER: "DRC + GERBER",
  ORDERING: "ORDERING",
  ASSEMBLY: "ASSEMBLY",
  BRINGUP: "BRING-UP",
  REVISION: "REVISION",
};
