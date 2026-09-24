import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import {
  cellId,
  computePosition,
  findCellIn,
  laneIdFor,
  NONE_LANE_ID,
  parseLaneId,
} from "./swimlane-ids";

const base = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "A",
  description: "",
  status: "todo" as const,
  priority: "medium" as const,
  assignee_kind: "human",
  position: 1,
  kind: "normal" as const,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

function task(over: Partial<Task> = {}): Task {
  return { ...base, ...over } as Task;
}

describe("swimlane-ids", () => {
  it("builds and parses lane ids", () => {
    expect(laneIdFor("assignee", "u1")).toBe("lane:assignee:u1");
    expect(parseLaneId("lane:assignee:u1")).toEqual({ grouping: "assignee", rawId: "u1" });
    expect(parseLaneId("lane:broken")).toBeNull();
    expect(parseLaneId(NONE_LANE_ID)).toBeNull();
  });

  it("builds cell ids and finds cells", () => {
    const id = cellId("lane:a", "todo");
    const cells = { "lane:a": { todo: ["t1", "t2"], done: [] } };
    const cellIds = new Set([id]);
    expect(findCellIn(cells, cellIds, id)).toEqual({ laneKey: "lane:a", status: "todo" });
    expect(findCellIn(cells, cellIds, "t2")).toEqual({ laneKey: "lane:a", status: "todo" });
    expect(findCellIn(cells, cellIds, "missing")).toBeNull();
    expect(findCellIn(cells, cellIds, "no::cell")).toBeNull();
  });

  it("computes positions from neighbors", () => {
    const map = new Map<string, Task>([
      ["a", task({ id: "a", position: 1 })],
      ["b", task({ id: "b", position: 3 })],
      ["c", task({ id: "c", position: 5 })],
    ]);
    expect(computePosition(["a", "b", "c"], "b", map)).toBe(3);
    expect(computePosition(["a", "b", "c"], "c", map)).toBe(4);
    expect(computePosition(["a", "b", "c"], "a", map)).toBe(2);
    expect(computePosition(["solo"], "solo", map)).toBe(0);
    expect(computePosition(["a", "b"], "missing", map)).toBe(0);
  });
});
