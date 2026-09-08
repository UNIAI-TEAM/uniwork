import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import { ganttCanvasRows } from "./gantt-canvas";

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

function task(over: Partial<Task>): Task {
  return { ...base, ...over } as Task;
}

describe("ganttCanvasRows", () => {
  it("drops undated tasks", () => {
    expect(
      ganttCanvasRows(
        [task({ id: "a" }), task({ id: "b", due_date: "2026-09-10" })],
        true,
      ).map((row) => row.id),
    ).toEqual(["b"]);
  });

  it("hides done/cancelled unless showCompleted", () => {
    const rows = [
      task({ id: "open", due_date: "2026-09-10", status: "todo" }),
      task({ id: "done", due_date: "2026-09-10", status: "done" }),
    ];
    expect(ganttCanvasRows(rows, false).map((r) => r.id)).toEqual(["open"]);
    expect(ganttCanvasRows(rows, true).map((r) => r.id)).toEqual([
      "open",
      "done",
    ]);
  });
});
