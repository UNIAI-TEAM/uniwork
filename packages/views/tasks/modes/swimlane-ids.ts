import type {
  CollisionDetection,
} from "@dnd-kit/core";
import { closestCenter, pointerWithin } from "@dnd-kit/core";
import type { Task } from "@uniwork/core/types";
import type { SwimlaneGrouping } from "@uniwork/core/tasks/stores/view-store-types";

export const COLUMN_WIDTH = 280;
export const COLUMN_GAP = 16;
export const SWIMLANE_LANE_SEED_COUNT = 6;
const LANE_ID_PREFIX = "lane:";
export const NONE_LANE_ID = "none";
export const ORPHAN_LANE_ID = "__orphans__";

export function cellId(laneKey: string, status: string): string {
  return `${laneKey}::${status}`;
}

function parseCellId(
  id: string,
): { laneKey: string; status: string } | null {
  const idx = id.lastIndexOf("::");
  if (idx < 0) return null;
  return { laneKey: id.slice(0, idx), status: id.slice(idx + 2) };
}

export function laneIdFor(grouping: SwimlaneGrouping, rawId: string): string {
  return `${LANE_ID_PREFIX}${grouping}:${rawId}`;
}

export function parseLaneId(
  id: string,
): { grouping: string; rawId: string } | null {
  if (!id.startsWith(LANE_ID_PREFIX)) return null;
  const rest = id.slice(LANE_ID_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return { grouping: rest.slice(0, idx), rawId: rest.slice(idx + 1) };
}

export function findCellIn(
  cells: Record<string, Record<string, string[]>>,
  cellIds: Set<string>,
  id: string,
): { laneKey: string; status: string } | null {
  const parsed = parseCellId(id);
  if (parsed && cellIds.has(id)) return parsed;
  for (const [laneKey, byStatus] of Object.entries(cells)) {
    for (const [status, ids] of Object.entries(byStatus)) {
      if (ids.includes(id)) return { laneKey, status };
    }
  }
  return null;
}

export function computePosition(
  ids: string[],
  activeId: string,
  taskMap: Map<string, Task>,
): number {
  const index = ids.indexOf(activeId);
  if (index < 0) return 0;
  const before = index > 0 ? taskMap.get(ids[index - 1]!) : undefined;
  const after =
    index < ids.length - 1 ? taskMap.get(ids[index + 1]!) : undefined;
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1;
  if (after) return after.position - 1;
  return 0;
}

export function makeSwimLaneCollision(
  cellIds: Set<string>,
): CollisionDetection {
  return (args) => {
    const activeId = args.active.id as string;
    const isLaneDrag = activeId.startsWith(LANE_ID_PREFIX);
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      let filtered = pointer;
      if (isLaneDrag) {
        filtered = pointer.filter((c) =>
          (c.id as string).startsWith(LANE_ID_PREFIX),
        );
      } else {
        filtered = pointer.filter(
          (c) => !(c.id as string).startsWith(LANE_ID_PREFIX),
        );
        const cellHits = filtered.filter((c) => cellIds.has(c.id as string));
        if (cellHits.length > 0) return cellHits;
      }
      if (filtered.length > 0) return filtered;
    }
    return closestCenter(args);
  };
}
