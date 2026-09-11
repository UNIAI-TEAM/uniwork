import { describe, expect, it } from "vitest";
import {
  getProjectTaskMetrics,
  leadFilterValue,
  projectProgressRatio,
  resolveProjectLeadName,
} from "./project-row-metrics";

describe("project-row-metrics", () => {
  it("exposes task totals from project counters", () => {
    expect(
      getProjectTaskMetrics({ task_count: 4, done_count: 1 }),
    ).toEqual({ totalCount: 4, completedCount: 1 });
  });

  it("computes progress ratio and lead filter value", () => {
    expect(projectProgressRatio({ task_count: 0, done_count: 0 })).toBe(-1);
    expect(projectProgressRatio({ task_count: 4, done_count: 1 })).toBe(0.25);
    expect(leadFilterValue({ lead_type: "member", lead_id: "u1" })).toBe(
      "member:u1",
    );
    expect(leadFilterValue({ lead_type: null, lead_id: null })).toBeNull();
  });

  it("resolves member lead display names and hides raw ids", () => {
    const names = new Map([["u1", "Me"]]);
    expect(
      resolveProjectLeadName({ lead_type: "member", lead_id: "u1" }, names),
    ).toBe("Me");
    expect(
      resolveProjectLeadName({ lead_type: "human", lead_id: "u1" }, names),
    ).toBe("Me");
    expect(
      resolveProjectLeadName({ lead_type: "agent", lead_id: "a1" }, names),
    ).toBeNull();
    expect(
      resolveProjectLeadName({ lead_type: "member", lead_id: "missing" }, names),
    ).toBeNull();
    expect(
      resolveProjectLeadName({ lead_type: null, lead_id: null }, names),
    ).toBeNull();
  });
});
