import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Task } from "@uniwork/core/types";
import type { LaneGroup } from "./swimlane-lanes";
import {
  computePosition,
  findCellIn,
  parseLaneId,
} from "./swimlane-ids";

type Cells = Record<string, Record<string, string[]>>;

type MoveTask = (
  taskId: string,
  updates: Record<string, unknown>,
  options?: { onSettled?: () => void },
) => void;

export function applySwimlaneDragOver({
  event,
  cellSet,
  laneByKey,
  recentlyMovedRef,
  setLocalCells,
}: {
  event: DragOverEvent;
  cellSet: Set<string>;
  laneByKey: Map<string, LaneGroup>;
  recentlyMovedRef: MutableRefObject<boolean>;
  setLocalCells: Dispatch<SetStateAction<Cells>>;
}): void {
  const { active, over } = event;
  if (!over || recentlyMovedRef.current) return;
  const activeId = active.id as string;
  const overId = over.id as string;
  setLocalCells((prev) => {
    const activeCell = findCellIn(prev, cellSet, activeId);
    const overCell = findCellIn(prev, cellSet, overId);
    if (!activeCell || !overCell) return prev;
    if (
      activeCell.laneKey === overCell.laneKey &&
      activeCell.status === overCell.status
    ) {
      return prev;
    }
    if (
      laneByKey.get(activeCell.laneKey)?.isOrphan ||
      laneByKey.get(overCell.laneKey)?.isOrphan
    ) {
      return prev;
    }
    recentlyMovedRef.current = true;
    const next = { ...prev };
    const from = [...(next[activeCell.laneKey]?.[activeCell.status] ?? [])];
    const toKey = overCell.laneKey;
    const toStatus = overCell.status;
    const to = [
      ...(toKey === activeCell.laneKey && toStatus === activeCell.status
        ? from
        : (next[toKey]?.[toStatus] ?? [])),
    ];
    const fromIdx = from.indexOf(activeId);
    if (fromIdx >= 0) from.splice(fromIdx, 1);
    const overIdx = to.indexOf(overId);
    const insertAt = overIdx >= 0 ? overIdx : to.length;
    if (!to.includes(activeId)) to.splice(insertAt, 0, activeId);
    next[activeCell.laneKey] = {
      ...next[activeCell.laneKey],
      [activeCell.status]: from,
    };
    next[toKey] = { ...next[toKey], [toStatus]: to };
    return next;
  });
}

export function applySwimlaneDragEnd({
  event,
  cells,
  cellSet,
  laneByKey,
  laneGroups,
  localCellsRef,
  taskMapRef,
  setLocalCells,
  setSwimlaneOrder,
  moveTask,
}: {
  event: DragEndEvent;
  cells: Cells;
  cellSet: Set<string>;
  laneByKey: Map<string, LaneGroup>;
  laneGroups: LaneGroup[];
  localCellsRef: MutableRefObject<Cells>;
  taskMapRef: MutableRefObject<Map<string, Task>>;
  setLocalCells: Dispatch<SetStateAction<Cells>>;
  setSwimlaneOrder: (order: string[]) => void;
  moveTask?: MoveTask;
}): void {
  const { active, over } = event;
  if (!over) {
    setLocalCells(cells);
    return;
  }
  const activeId = active.id as string;
  const laneDrag = parseLaneId(activeId);
  if (laneDrag) {
    const nonPinned = laneGroups
      .filter((lane) => !lane.isPinned)
      .map((lane) => lane.rawId);
    const overLane = parseLaneId(over.id as string);
    if (!overLane) return;
    const from = nonPinned.indexOf(laneDrag.rawId);
    const to = nonPinned.indexOf(overLane.rawId);
    if (from < 0 || to < 0 || from === to) return;
    setSwimlaneOrder(arrayMove(nonPinned, from, to));
    return;
  }

  const activeCell = findCellIn(localCellsRef.current, cellSet, activeId);
  if (!activeCell) {
    setLocalCells(cells);
    return;
  }
  const lane = laneByKey.get(activeCell.laneKey);
  if (!lane || lane.isOrphan) {
    setLocalCells(cells);
    return;
  }
  const ids =
    localCellsRef.current[activeCell.laneKey]?.[activeCell.status] ?? [];
  const position = computePosition(ids, activeId, taskMapRef.current);
  moveTask?.(
    activeId,
    {
      ...lane.moveUpdates,
      status: activeCell.status,
      position,
    },
  );
}
