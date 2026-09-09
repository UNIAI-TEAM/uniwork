import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import type { BoardColumnGroup } from "./board-column";
import {
  buildColumns,
  computePosition,
  findColumn,
  getMoveUpdates,
  insertIdByPosition,
  statusGroupId,
  taskMatchesGroup,
} from "./board-drag-utils";

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

describe("board-drag-utils", () => {
  const groups: BoardColumnGroup[] = [
    { id: statusGroupId("todo"), title: "Todo", status: "todo" },
    { id: statusGroupId("done"), title: "Done", status: "done" },
    { id: "custom", title: "Custom" },
  ];

  it("builds columns by status group", () => {
    expect(
      buildColumns(
        [task({ id: "a", status: "todo" }), task({ id: "b", status: "done" }), task({ id: "c", status: "blocked" })],
        groups,
      ),
    ).toEqual({
      [statusGroupId("todo")]: ["a"],
      [statusGroupId("done")]: ["b"],
      custom: [],
    });
  });

  it("computes insert positions", () => {
    const map = new Map([
      ["a", task({ id: "a", position: 1 })],
      ["b", task({ id: "b", position: 3 })],
      ["c", task({ id: "c", position: 5 })],
    ]);
    expect(computePosition(["a"], "a", map)).toBe(1);
    expect(computePosition(["a", "b", "c"], "a", map)).toBe(2);
    expect(computePosition(["a", "b", "c"], "c", map)).toBe(4);
    expect(computePosition(["a", "b", "c"], "b", map)).toBe(3);
    expect(computePosition(["a", "b"], "missing", map)).toBe(0);
  });

  it("inserts ids by position", () => {
    const map = new Map([
      ["a", task({ id: "a", position: 1 })],
      ["c", task({ id: "c", position: 5 })],
    ]);
    expect(insertIdByPosition(["a", "c"], "b", 3, map)).toEqual(["a", "b", "c"]);
    expect(insertIdByPosition(["a", "c"], "z", 9, map)).toEqual(["a", "c", "z"]);
  });

  it("finds columns by id or contained task", () => {
    const columns = { [statusGroupId("todo")]: ["a"], [statusGroupId("done")]: ["b"] };
    const ids = new Set(Object.keys(columns));
    expect(findColumn(columns, statusGroupId("todo"), ids)).toBe(statusGroupId("todo"));
    expect(findColumn(columns, "b", ids)).toBe(statusGroupId("done"));
    expect(findColumn(columns, "missing", ids)).toBeNull();
  });

  it("matches groups and builds move updates", () => {
    const todo = groups[0]!;
    const custom = groups[2]!;
    expect(taskMatchesGroup(task({ status: "todo" }), todo)).toBe(true);
    expect(taskMatchesGroup(task({ status: "done" }), todo)).toBe(false);
    expect(taskMatchesGroup(task({ status: "todo" }), custom)).toBe(false);
    expect(getMoveUpdates(todo, 2, task({ status: "todo" }))).toEqual({ position: 2 });
    expect(getMoveUpdates(todo, 2, task({ status: "done" }))).toEqual({
      status: "todo",
      position: 2,
    });
    expect(getMoveUpdates(custom, 4)).toEqual({ position: 4 });
  });
});
