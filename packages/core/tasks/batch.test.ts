import { describe, expect, it } from "vitest";
import type { Task } from "../types/task";
import { commonTaskFields } from "./batch";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    organization_id: "o1",
    workspace_id: "w1",
    number: 1,
    identifier: "UW-1",
    revision: 1,
    title: "Task",
    description: "",
    status: "todo",
    priority: "medium",
    position: 1,
    kind: "normal",
    created_by: "u1",
    created_by_kind: "human",
    assignee_kind: "human",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    ...over,
  };
}

describe("commonTaskFields", () => {
  it("returns shared status priority and assignee", () => {
    const fields = commonTaskFields([
      makeTask({ id: "a", status: "in_progress", priority: "high", assignee_id: "u1", assignee_kind: "human" }),
      makeTask({ id: "b", status: "in_progress", priority: "high", assignee_id: "u1", assignee_kind: "human" }),
    ]);
    expect(fields.status).toBe("in_progress");
    expect(fields.priority).toBe("high");
    expect(fields.assignee).toEqual({ kind: "human", id: "u1" });
  });

  it("returns null fields when the selection is mixed", () => {
    const fields = commonTaskFields([
      makeTask({ id: "a", status: "todo", priority: "low", assignee_id: "u1", assignee_kind: "human" }),
      makeTask({ id: "b", status: "done", priority: "urgent", assignee_id: "a1", assignee_kind: "agent" }),
    ]);
    expect(fields.status).toBeNull();
    expect(fields.priority).toBeNull();
    expect(fields.assignee).toBeNull();
  });

  it("treats all-unassigned as a shared unassigned value", () => {
    const fields = commonTaskFields([
      makeTask({ id: "a", assignee_id: undefined, assignee_kind: "human" }),
      makeTask({ id: "b", assignee_id: undefined, assignee_kind: "human" }),
    ]);
    expect(fields.assignee).toEqual({ kind: "human", id: null });
  });
});
