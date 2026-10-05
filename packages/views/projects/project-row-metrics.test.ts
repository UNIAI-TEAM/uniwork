import { describe, expect, it } from "vitest";
import type { AssigneeOption } from "../tasks/pickers/assignee-picker";
import {
  findProjectLeadOption,
  getProjectTaskMetrics,
  leadFilterValue,
  leadRefToProjectBody,
  projectLeadRef,
  projectProgressRatio,
  resolveProjectLeadName,
} from "./project-row-metrics";

const options: AssigneeOption[] = [
  { id: "u1", kind: "human", name: "Me", avatarUrl: "https://x/me.png" },
  { id: "a1", kind: "agent", name: "Uni Bot" },
];

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

  it("maps project lead_type onto the picker's actor kind", () => {
    expect(projectLeadRef({ lead_type: "member", lead_id: "u1" })).toEqual({
      id: "u1",
      kind: "human",
    });
    expect(projectLeadRef({ lead_type: "human", lead_id: "u1" })).toEqual({
      id: "u1",
      kind: "human",
    });
    expect(projectLeadRef({ lead_type: "agent", lead_id: "a1" })).toEqual({
      id: "a1",
      kind: "agent",
    });
    expect(projectLeadRef({ lead_type: "robot", lead_id: "x" })).toBeNull();
    expect(projectLeadRef({ lead_type: null, lead_id: null })).toBeNull();
  });

  it("maps a picker ref back onto the project body", () => {
    expect(leadRefToProjectBody({ id: "u1", kind: "human" })).toEqual({
      lead_type: "member",
      lead_id: "u1",
    });
    expect(leadRefToProjectBody({ id: "a1", kind: "agent" })).toEqual({
      lead_type: "agent",
      lead_id: "a1",
    });
    expect(leadRefToProjectBody(null)).toEqual({ lead_type: null, lead_id: null });
  });

  it("resolves member and agent lead names and hides raw ids", () => {
    expect(
      resolveProjectLeadName({ lead_type: "member", lead_id: "u1" }, options),
    ).toBe("Me");
    expect(
      resolveProjectLeadName({ lead_type: "agent", lead_id: "a1" }, options),
    ).toBe("Uni Bot");
    expect(
      findProjectLeadOption({ lead_type: "agent", lead_id: "a1" }, options)?.kind,
    ).toBe("agent");
    expect(
      resolveProjectLeadName({ lead_type: "agent", lead_id: "u1" }, options),
    ).toBeNull();
    expect(
      resolveProjectLeadName({ lead_type: "member", lead_id: "missing" }, options),
    ).toBeNull();
    expect(
      resolveProjectLeadName({ lead_type: null, lead_id: null }, options),
    ).toBeNull();
  });
});
