import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_FILTERS } from "@uniwork/core/projects/stores/view-store";
import type { Project } from "@uniwork/core/types/project";
import {
  countProjectLeads,
  filterAndSortProjects,
  leadFiltersToActors,
} from "./projects-list-visible";

function project(overrides: Partial<Project>): Project {
  return {
    id: "p",
    organization_id: "o1",
    workspace_id: "w1",
    title: "Untitled",
    description: "",
    icon: null,
    status: "planned",
    priority: "none",
    lead_type: null,
    lead_id: null,
    start_date: null,
    due_date: null,
    revision: 1,
    task_count: 0,
    done_count: 0,
    resource_count: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

const alpha = project({
  id: "p1",
  title: "Dự án Tết",
  priority: "high",
  status: "in_progress",
  lead_type: "agent",
  lead_id: "a1",
  created_at: "2026-06-03T00:00:00Z",
});
const beta = project({
  id: "p2",
  title: "Báo cáo quý",
  priority: "urgent",
  lead_type: "member",
  lead_id: "u1",
  created_at: "2026-06-01T00:00:00Z",
});
const gamma = project({
  id: "p3",
  title: "Kế hoạch",
  priority: "strange",
  created_at: "2026-06-02T00:00:00Z",
});
const all = [alpha, beta, gamma];

const base = {
  search: "",
  filters: EMPTY_PROJECT_FILTERS,
  sortField: "created" as const,
  sortDirection: "desc" as const,
};

describe("filterAndSortProjects", () => {
  it("matches titles without diacritics", () => {
    const ids = filterAndSortProjects(all, { ...base, search: "du an tet" }).map((p) => p.id);
    expect(ids).toEqual(["p1"]);
  });

  it("filters by an agent lead", () => {
    const ids = filterAndSortProjects(all, {
      ...base,
      filters: { ...EMPTY_PROJECT_FILTERS, leads: ["agent:a1"] },
    }).map((p) => p.id);
    expect(ids).toEqual(["p1"]);
  });

  it("sorts by created date and by priority with unknown values last", () => {
    expect(filterAndSortProjects(all, base).map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
    expect(
      filterAndSortProjects(all, { ...base, sortField: "priority" }).map((p) => p.id),
    ).toEqual(["p2", "p1", "p3"]);
  });
});

describe("countProjectLeads", () => {
  it("counts member and agent leads over all projects, keyed like the filter", () => {
    const counts = countProjectLeads([...all, project({ id: "p4", lead_type: "member", lead_id: "u1" })]);
    expect([...counts]).toEqual([
      ["agent:a1", 1],
      ["member:u1", 2],
    ]);
  });
});

describe("leadFiltersToActors", () => {
  it("maps stored lead keys onto the shared actor filter and drops unknown ones", () => {
    expect(leadFiltersToActors(["member:u1", "agent:a1", "squad:s1", "bogus", "member:"])).toEqual([
      { type: "member", id: "u1" },
      { type: "agent", id: "a1" },
    ]);
  });
});
