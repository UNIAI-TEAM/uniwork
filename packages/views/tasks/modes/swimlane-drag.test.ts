import { describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import type { Task } from "@uniwork/core/types";
import { cellId, laneIdFor, NONE_LANE_ID } from "./swimlane-ids";
import type { LaneGroup } from "./swimlane-lanes";
import { applySwimlaneDragEnd, applySwimlaneDragOver } from "./swimlane-drag";

type Cells = Record<string, Record<string, string[]>>;

const baseTask: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "A",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

function lane(over: Partial<LaneGroup> & Pick<LaneGroup, "key" | "rawId">): LaneGroup {
  return {
    isPinned: false,
    isOrphan: false,
    title: over.rawId,
    identifier: "",
    parentTask: null,
    projectId: null,
    actor: null,
    matches: () => false,
    moveUpdates: { parent_task_id: over.rawId },
    ...over,
  };
}

function dragOver(activeId: string, overId: string | null): DragOverEvent {
  return {
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  } as DragOverEvent;
}

function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  } as DragEndEvent;
}

describe("applySwimlaneDragOver", () => {
  it("no-ops without over target or while recently moved", () => {
    const setLocalCells = vi.fn();
    applySwimlaneDragOver({
      event: dragOver("t1", null),
      cellSet: new Set(),
      laneByKey: new Map(),
      recentlyMovedRef: { current: false },
      setLocalCells,
    });
    expect(setLocalCells).not.toHaveBeenCalled();

    applySwimlaneDragOver({
      event: dragOver("t1", "x"),
      cellSet: new Set(),
      laneByKey: new Map(),
      recentlyMovedRef: { current: true },
      setLocalCells,
    });
    expect(setLocalCells).not.toHaveBeenCalled();
  });

  it("moves a task into another cell and skips orphan lanes", () => {
    const fromCell = cellId("parent:p1", "todo");
    const toCell = cellId("parent:p2", "in_progress");
    const orphanCell = cellId("parent:orphan", "todo");
    const cellSet = new Set([fromCell, toCell, orphanCell]);
    const laneByKey = new Map<string, LaneGroup>([
      ["parent:p1", lane({ key: "parent:p1", rawId: "p1" })],
      ["parent:p2", lane({ key: "parent:p2", rawId: "p2" })],
      ["parent:orphan", lane({ key: "parent:orphan", rawId: "orphan", isOrphan: true })],
    ]);

    let cells: Cells = {
      "parent:p1": { todo: ["t1", "t2"] },
      "parent:p2": { in_progress: ["t3"] },
      "parent:orphan": { todo: [] },
    };
    const recentlyMovedRef = { current: false };
    const setLocalCells: Dispatch<SetStateAction<Cells>> = (value) => {
      cells = typeof value === "function" ? value(cells) : value;
    };

    applySwimlaneDragOver({
      event: dragOver("t1", "t3"),
      cellSet,
      laneByKey,
      recentlyMovedRef,
      setLocalCells,
    });
    expect(recentlyMovedRef.current).toBe(true);
    expect(cells["parent:p1"]?.todo).toEqual(["t2"]);
    expect(cells["parent:p2"]?.in_progress).toEqual(["t1", "t3"]);

    recentlyMovedRef.current = false;
    applySwimlaneDragOver({
      event: dragOver("t2", cellId("parent:orphan", "todo")),
      cellSet,
      laneByKey,
      recentlyMovedRef,
      setLocalCells,
    });
    expect(recentlyMovedRef.current).toBe(false);
  });

  it("returns previous cells when active/over cell missing or same cell", () => {
    const cell = cellId("parent:p1", "todo");
    const cellSet = new Set([cell]);
    const laneByKey = new Map([["parent:p1", lane({ key: "parent:p1", rawId: "p1" })]]);
    const prev: Cells = { "parent:p1": { todo: ["t1", "t2"] } };
    let next = prev;
    const setLocalCells: Dispatch<SetStateAction<Cells>> = (value) => {
      next = typeof value === "function" ? value(prev) : value;
    };

    applySwimlaneDragOver({
      event: dragOver("missing", "t2"),
      cellSet,
      laneByKey,
      recentlyMovedRef: { current: false },
      setLocalCells,
    });
    expect(next).toBe(prev);

    applySwimlaneDragOver({
      event: dragOver("t1", "t2"),
      cellSet,
      laneByKey,
      recentlyMovedRef: { current: false },
      setLocalCells,
    });
    expect(next).toBe(prev);
  });
});

describe("applySwimlaneDragEnd", () => {
  it("resets local cells when there is no over target", () => {
    const setLocalCells = vi.fn();
    applySwimlaneDragEnd({
      event: dragEnd("t1", null),
      cells: { "parent:p1": { todo: ["t1"] } },
      cellSet: new Set(),
      laneByKey: new Map(),
      laneGroups: [],
      localCellsRef: { current: {} },
      taskMapRef: { current: new Map() },
      setLocalCells,
      setSwimlaneOrder: vi.fn(),
    });
    expect(setLocalCells).toHaveBeenCalledWith({ "parent:p1": { todo: ["t1"] } });
  });

  it("reorders non-pinned lanes when dragging a lane handle", () => {
    const setSwimlaneOrder = vi.fn();
    const laneGroups = [
      lane({ key: `parent:${NONE_LANE_ID}`, rawId: NONE_LANE_ID, isPinned: true }),
      lane({ key: "parent:p1", rawId: "p1" }),
      lane({ key: "parent:p2", rawId: "p2" }),
      lane({ key: "parent:p3", rawId: "p3" }),
    ];
    applySwimlaneDragEnd({
      event: dragEnd(laneIdFor("parent", "p1"), laneIdFor("parent", "p3")),
      cells: {},
      cellSet: new Set(),
      laneByKey: new Map(),
      laneGroups,
      localCellsRef: { current: {} },
      taskMapRef: { current: new Map() },
      setLocalCells: vi.fn(),
      setSwimlaneOrder,
    });
    expect(setSwimlaneOrder).toHaveBeenCalledWith(["p2", "p3", "p1"]);
  });

  it("ignores lane drags onto unknown or same lane", () => {
    const setSwimlaneOrder = vi.fn();
    const laneGroups = [
      lane({ key: "parent:p1", rawId: "p1" }),
      lane({ key: "parent:p2", rawId: "p2" }),
    ];
    applySwimlaneDragEnd({
      event: dragEnd(laneIdFor("parent", "p1"), "not-a-lane"),
      cells: {},
      cellSet: new Set(),
      laneByKey: new Map(),
      laneGroups,
      localCellsRef: { current: {} },
      taskMapRef: { current: new Map() },
      setLocalCells: vi.fn(),
      setSwimlaneOrder,
    });
    expect(setSwimlaneOrder).not.toHaveBeenCalled();

    applySwimlaneDragEnd({
      event: dragEnd(laneIdFor("parent", "p1"), laneIdFor("parent", "p1")),
      cells: {},
      cellSet: new Set(),
      laneByKey: new Map(),
      laneGroups,
      localCellsRef: { current: {} },
      taskMapRef: { current: new Map() },
      setLocalCells: vi.fn(),
      setSwimlaneOrder,
    });
    expect(setSwimlaneOrder).not.toHaveBeenCalled();
  });

  it("persists task move updates and resets orphan/missing cells", () => {
    const moveTask = vi.fn();
    const setLocalCells = vi.fn();
    const fromCell = cellId("parent:p1", "todo");
    const cellSet = new Set([fromCell]);
    const laneByKey = new Map([
      ["parent:p1", lane({ key: "parent:p1", rawId: "p1" })],
      ["parent:orphan", lane({ key: "parent:orphan", rawId: "orphan", isOrphan: true })],
    ]);
    const cells = { "parent:p1": { todo: ["t1", "t2"] } };

    applySwimlaneDragEnd({
      event: dragEnd("t1", "t2"),
      cells,
      cellSet,
      laneByKey,
      laneGroups: [],
      localCellsRef: { current: cells },
      taskMapRef: {
        current: new Map([
          ["t1", { ...baseTask, id: "t1", position: 1 }],
          ["t2", { ...baseTask, id: "t2", position: 2 }],
        ]),
      },
      setLocalCells,
      setSwimlaneOrder: vi.fn(),
      moveTask,
    });
    expect(moveTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        parent_task_id: "p1",
        status: "todo",
        position: expect.any(Number),
      }),
    );

    applySwimlaneDragEnd({
      event: dragEnd("missing", "t2"),
      cells,
      cellSet,
      laneByKey,
      laneGroups: [],
      localCellsRef: { current: cells },
      taskMapRef: { current: new Map() },
      setLocalCells,
      setSwimlaneOrder: vi.fn(),
      moveTask,
    });
    expect(setLocalCells).toHaveBeenCalledWith(cells);
  });
});
