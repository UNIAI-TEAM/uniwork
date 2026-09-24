import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import { NONE_LANE_ID, ORPHAN_LANE_ID } from "./swimlane-ids";
import { buildLanesForGrouping } from "./swimlane-lanes";

const labels = {
  noParent: "No parent",
  otherParents: "Other parents",
  noProject: "No project",
  noAssignee: "Unassigned",
};

const base: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Child",
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

function task(over: Partial<Task> = {}): Task {
  return { ...base, ...over };
}

describe("buildLanesForGrouping — parent", () => {
  it("always includes the pinned no-parent lane", () => {
    const lanes = buildLanesForGrouping(
      "parent",
      [task({ parent_task_id: null })],
      [],
      [],
      labels,
      () => "?",
      new Map(),
    );
    expect(lanes[0]?.rawId).toBe(NONE_LANE_ID);
    expect(lanes[0]?.isPinned).toBe(true);
    expect(lanes[0]?.matches(task({ parent_task_id: null }))).toBe(true);
    expect(lanes[0]?.matches(task({ parent_task_id: "p1" }))).toBe(false);
    expect(lanes[0]?.moveUpdates).toEqual({ parent_task_id: null });
  });

  it("builds parent lanes from metadata and skips duplicates", () => {
    const parent = task({
      id: "p1",
      title: "Epic",
      identifier: "T-10",
    });
    const lanes = buildLanesForGrouping(
      "parent",
      [
        task({ id: "c1", parent_task_id: "p1" }),
        task({ id: "c2", parent_task_id: "p1" }),
      ],
      [parent],
      [],
      labels,
      () => "?",
      new Map(),
    );
    const parentLane = lanes.find((lane) => lane.rawId === "p1");
    expect(parentLane).toMatchObject({
      title: "Epic",
      identifier: "T-10",
      isOrphan: false,
      moveUpdates: { parent_task_id: "p1" },
    });
    expect(parentLane?.matches(task({ parent_task_id: "p1" }))).toBe(true);
    expect(parentLane?.matches(task({ parent_task_id: "p2" }))).toBe(false);
    expect(lanes.filter((lane) => lane.rawId === "p1")).toHaveLength(1);
  });

  it("adds an orphan lane when a parent is missing from metadata", () => {
    const lanes = buildLanesForGrouping(
      "parent",
      [task({ parent_task_id: "missing" })],
      [],
      [],
      labels,
      () => "?",
      new Map(),
    );
    const orphan = lanes.find((lane) => lane.rawId === ORPHAN_LANE_ID);
    expect(orphan).toMatchObject({
      isPinned: true,
      isOrphan: true,
      title: labels.otherParents,
      moveUpdates: {},
    });
    expect(orphan?.matches(task())).toBe(false);
  });

  it("orders parent lanes by stored order, then leaves unordered ties stable", () => {
    const p1 = task({ id: "p1", title: "A", identifier: "T-1" });
    const p2 = task({ id: "p2", title: "B", identifier: "T-2" });
    const p3 = task({ id: "p3", title: "C", identifier: "T-3" });
    const lanes = buildLanesForGrouping(
      "parent",
      [
        task({ id: "c1", parent_task_id: "p2" }),
        task({ id: "c2", parent_task_id: "p1" }),
        task({ id: "c3", parent_task_id: "p3" }),
      ],
      [p1, p2, p3],
      ["p2", "p1"],
      labels,
      () => "?",
      new Map(),
    );
    const orderedIds = lanes
      .filter((lane) => !lane.isPinned)
      .map((lane) => lane.rawId);
    expect(orderedIds).toEqual(["p2", "p1", "p3"]);
  });

  it("prefers stored-order lanes over unordered ones when only one side is ranked", () => {
    const p1 = task({ id: "p1", title: "A", identifier: "T-1" });
    const p2 = task({ id: "p2", title: "B", identifier: "T-2" });
    const lanes = buildLanesForGrouping(
      "parent",
      [
        task({ id: "c1", parent_task_id: "p1" }),
        task({ id: "c2", parent_task_id: "p2" }),
      ],
      [p1, p2],
      ["p2"],
      labels,
      () => "?",
      new Map(),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["p2", "p1"]);
  });
});

describe("buildLanesForGrouping — project", () => {
  it("builds project lanes with title fallback and none lane", () => {
    const lanes = buildLanesForGrouping(
      "project",
      [
        task({ id: "a", project_id: "proj-1" }),
        task({ id: "b", project_id: "proj-1" }),
        task({ id: "c", project_id: "proj-2" }),
        task({ id: "d", project_id: null }),
      ],
      [],
      [],
      labels,
      () => "?",
      new Map([["proj-1", "Alpha"]]),
    );
    expect(lanes[0]?.rawId).toBe(NONE_LANE_ID);
    expect(lanes[0]?.matches(task({ project_id: null }))).toBe(true);
    expect(lanes[0]?.moveUpdates).toEqual({ project_id: null });

    const known = lanes.find((lane) => lane.rawId === "proj-1");
    expect(known?.title).toBe("Alpha");
    expect(known?.matches(task({ project_id: "proj-1" }))).toBe(true);
    expect(known?.moveUpdates).toEqual({ project_id: "proj-1" });

    const unknown = lanes.find((lane) => lane.rawId === "proj-2");
    expect(unknown?.title).toBe("proj-2");
  });

  it("sorts projects by stored order then title", () => {
    const lanes = buildLanesForGrouping(
      "project",
      [
        task({ id: "a", project_id: "z" }),
        task({ id: "b", project_id: "a" }),
        task({ id: "c", project_id: "m" }),
      ],
      [],
      ["m"],
      labels,
      () => "?",
      new Map([
        ["z", "Zebra"],
        ["a", "Apple"],
        ["m", "Mango"],
      ]),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["m", "a", "z"]);
  });

  it("ranks a stored-order project above an unordered peer", () => {
    const lanes = buildLanesForGrouping(
      "project",
      [task({ project_id: "b" }), task({ id: "x", project_id: "a" })],
      [],
      ["b"],
      labels,
      () => "?",
      new Map([
        ["a", "A"],
        ["b", "B"],
      ]),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["b", "a"]);
  });
});

describe("buildLanesForGrouping — assignee", () => {
  it("defaults missing assignee_kind to human and builds matches", () => {
    const getActorName = (kind: string, id: string) => `${kind}:${id}`;
    const lanes = buildLanesForGrouping(
      "assignee",
      [
        task({ id: "a", assignee_id: "u1", assignee_kind: undefined }),
        task({ id: "b", assignee_id: "u1" }),
        task({ id: "c", assignee_id: "bot", assignee_kind: "agent" }),
        task({ id: "d", assignee_id: undefined }),
      ],
      [],
      [],
      labels,
      getActorName,
      new Map(),
    );

    expect(lanes[0]?.rawId).toBe(NONE_LANE_ID);
    expect(lanes[0]?.matches(task({ assignee_id: undefined }))).toBe(true);
    expect(lanes[0]?.moveUpdates).toEqual({
      assignee_id: null,
      assignee_kind: null,
    });

    const human = lanes.find((lane) => lane.rawId === "human:u1");
    expect(human?.title).toBe("human:u1");
    expect(human?.actor).toEqual({ kind: "human", id: "u1" });
    expect(
      human?.matches(task({ assignee_id: "u1", assignee_kind: "human" })),
    ).toBe(true);
    expect(
      human?.matches(task({ assignee_id: "u1", assignee_kind: undefined })),
    ).toBe(true);
    expect(
      human?.matches(task({ assignee_id: "bot", assignee_kind: "agent" })),
    ).toBe(false);

    const agent = lanes.find((lane) => lane.rawId === "agent:bot");
    expect(agent?.moveUpdates).toEqual({
      assignee_kind: "agent",
      assignee_id: "bot",
    });
  });

  it("sorts humans before agents then by title when order is empty", () => {
    const lanes = buildLanesForGrouping(
      "assignee",
      [
        task({ id: "a", assignee_id: "z", assignee_kind: "agent" }),
        task({ id: "b", assignee_id: "b", assignee_kind: "human" }),
        task({ id: "c", assignee_id: "a", assignee_kind: "member" }),
        task({ id: "d", assignee_id: "x", assignee_kind: "system" }),
      ],
      [],
      [],
      labels,
      (kind, id) => `${kind}-${id}`,
      new Map(),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["human:b", "member:a", "agent:z", "system:x"]);
  });

  it("applies stored assignee order over type/title ranking", () => {
    const lanes = buildLanesForGrouping(
      "assignee",
      [
        task({ id: "a", assignee_id: "u1", assignee_kind: "human" }),
        task({ id: "b", assignee_id: "bot", assignee_kind: "agent" }),
      ],
      [],
      ["agent:bot", "human:u1"],
      labels,
      (kind, id) => id,
      new Map(),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["agent:bot", "human:u1"]);
  });

  it("ranks a stored assignee ahead of an unordered peer", () => {
    const lanes = buildLanesForGrouping(
      "assignee",
      [
        task({ id: "a", assignee_id: "u2", assignee_kind: "human" }),
        task({ id: "b", assignee_id: "u1", assignee_kind: "human" }),
      ],
      [],
      ["human:u2"],
      labels,
      (_kind, id) => id,
      new Map(),
    );
    expect(
      lanes.filter((lane) => !lane.isPinned).map((lane) => lane.rawId),
    ).toEqual(["human:u2", "human:u1"]);
  });
});
