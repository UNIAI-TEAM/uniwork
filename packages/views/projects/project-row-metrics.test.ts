import { describe, expect, it } from "vitest";
import {
  getProjectTaskMetrics,
  leadFilterValue,
  projectProgressRatio,
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
});
