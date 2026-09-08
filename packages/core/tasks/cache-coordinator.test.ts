import { describe, expect, it } from "vitest";
import { planCacheUpdate } from "./cache-coordinator";
import { taskKeys } from "./keys";

describe("planCacheUpdate", () => {
  it("invalidates list/my-tasks/query/table and detail on task.updated", () => {
    const plan = planCacheUpdate("ws1", {
      type: "task.updated",
      payload: { task_id: "t1" },
    });
    expect(plan.type).toBe("invalidate");
    expect(plan.keys).toEqual(
      expect.arrayContaining([
        taskKeys.list("ws1"),
        taskKeys.myTasks("ws1"),
        taskKeys.queryRoot("ws1"),
        taskKeys.tableRoot("ws1"),
        taskKeys.detail("t1"),
        taskKeys.children("t1"),
      ]),
    );
  });

  it("invalidates comments on task.comment_added", () => {
    const plan = planCacheUpdate("ws1", {
      type: "task.comment_added",
      payload: { task_id: "t1", comment_id: "c1" },
    });
    expect(plan).toEqual({
      type: "invalidate",
      keys: [taskKeys.comments("t1")],
    });
  });

  it("invalidates catalog keys for status/label events", () => {
    expect(planCacheUpdate("ws1", { type: "task_status.created" }).keys).toEqual([
      taskKeys.statuses("ws1"),
    ]);
    expect(
      planCacheUpdate("ws1", { type: "task_label.updated", payload: { label_id: "l1" } }).keys,
    ).toEqual([taskKeys.labels("ws1"), taskKeys.label("ws1", "l1")]);
  });

  it("invalidates project and resources", () => {
    const plan = planCacheUpdate("ws1", {
      type: "project_resource.created",
      payload: { project_id: "p1" },
    });
    expect(plan.keys).toEqual([
      taskKeys.project("ws1", "p1"),
      taskKeys.projectResources("ws1", "p1"),
    ]);
  });

  it("invalidates views root (prefix of scoped live keys) and prefs root", () => {
    expect(planCacheUpdate("ws1", { type: "task_view.created" }).keys).toEqual([
      taskKeys.views("ws1"),
    ]);
    expect(planCacheUpdate("ws1", { type: "task_view_preference.updated" }).keys).toEqual([
      taskKeys.viewPrefs("ws1"),
    ]);
  });

  it("returns empty keys for unknown events", () => {
    expect(planCacheUpdate("ws1", { type: "chat.message" })).toEqual({
      type: "invalidate",
      keys: [],
    });
  });
});
