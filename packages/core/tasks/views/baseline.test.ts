// @vitest-environment node
import { describe, it, expect } from "vitest";
import { actorFilterKey, baselineFromQuery } from "./baseline";

describe("baselineFromQuery", () => {
  it("builds sets and raw snapshot from a saved-view query blob", () => {
    const baseline = baselineFromQuery({
      statusFilters: ["todo", "custom_qa"],
      priorityFilters: ["high", "nope"],
      assigneeFilters: [{ type: "member", id: "u1" }],
      includeNoAssignee: true,
      creatorFilters: [],
      projectFilters: ["p1"],
      includeNoProject: false,
      labelFilters: ["l1"],
      propertyFilters: { prop1: ["opt1"] },
    });
    expect(baseline.status.has("custom_qa")).toBe(true);
    expect(baseline.priority.has("high")).toBe(true);
    expect(baseline.priority.has("nope")).toBe(false);
    expect(baseline.assignee.has(actorFilterKey({ type: "member", id: "u1" }))).toBe(true);
    expect(baseline.includeNoAssignee).toBe(true);
    expect(baseline.raw.statusFilters).toEqual(["todo", "custom_qa"]);
    expect(baseline.property.get("prop1")?.has("opt1")).toBe(true);
  });
});
