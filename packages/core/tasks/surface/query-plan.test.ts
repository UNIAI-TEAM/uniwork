import { describe, expect, it } from "vitest";
import type { FilterSnapshot } from "../stores/view-store-types";
import { buildSurfaceTableFilter, planSurfaceQuery } from "./query-plan";

describe("planSurfaceQuery", () => {
  it("routes my scope to my_tasks plan", () => {
    const plan = planSurfaceQuery({
      scope: { type: "my", userId: "u1", relation: "assigned" },
      viewMode: "list",
    });
    expect(plan.kind).toBe("my_tasks");
    expect(plan.myTasksOpts?.relation).toBe("assigned");
  });

  it("routes workspace table mode to table plan kind", () => {
    const plan = planSurfaceQuery({
      scope: { type: "workspace" },
      viewMode: "table",
    });
    expect(plan.kind).toBe("table");
  });

  it("plans my scope table mode as a table query carrying the relation", () => {
    const plan = planSurfaceQuery({
      scope: { type: "my", userId: "u1", relation: "created" },
      viewMode: "table",
      filter: { statuses: ["todo"], relation: "created" },
    });
    expect(plan).toMatchObject({
      kind: "table",
      tableBody: { filter: { statuses: ["todo"], relation: "created" } },
    });
  });

  it("adds the relation when a my table plan has no other filter", () => {
    const plan = planSurfaceQuery({
      scope: { type: "my", userId: "u1", relation: "all" },
      viewMode: "table",
    });
    expect(plan.tableBody?.filter).toEqual({ relation: "all" });
  });

  it("puts statusFilters into tableBody.filter.statuses", () => {
    const plan = planSurfaceQuery({
      scope: { type: "workspace" },
      viewMode: "table",
      filter: { statuses: ["todo", "in_progress"] },
    });
    expect(plan).toMatchObject({
      kind: "table",
      tableBody: { filter: { statuses: ["todo", "in_progress"] } },
    });
  });

  it("merges store filter with project_ids on project table scope", () => {
    const plan = planSurfaceQuery({
      scope: { type: "project", projectId: "p1" },
      viewMode: "table",
      filter: { statuses: ["todo"], project_ids: ["ignored"] },
    });
    expect(plan.tableBody?.filter).toEqual({
      statuses: ["todo"],
      project_ids: ["p1"],
    });
  });
});

describe("project scope", () => {
  it("plans board query with project_id", () => {
    expect(
      planSurfaceQuery({
        scope: { type: "project", projectId: "p1" },
        viewMode: "board",
      }),
    ).toEqual({
      kind: "workspace_query",
      queryBody: { project_id: "p1" },
    });
  });

  it("plans table filter with project_ids", () => {
    expect(
      planSurfaceQuery({
        scope: { type: "project", projectId: "p1" },
        viewMode: "table",
      }),
    ).toMatchObject({
      kind: "table",
      tableBody: { filter: { project_ids: ["p1"] } },
    });
  });
});

describe("buildSurfaceTableFilter", () => {
  const snapshot: FilterSnapshot = {
    statusFilters: [],
    priorityFilters: [],
    assigneeFilters: [],
    includeNoAssignee: false,
    creatorFilters: [],
    projectFilters: [],
    includeNoProject: false,
    labelFilters: [],
    propertyFilters: {},
  };

  it("always carries the relation for my scope, even with no other filter", () => {
    expect(
      buildSurfaceTableFilter({
        scope: { type: "my", userId: "u1", relation: "assigned" },
        snapshot,
      }),
    ).toEqual({ relation: "assigned" });
  });

  it("leaves workspace scope without a relation", () => {
    expect(
      buildSurfaceTableFilter({ scope: { type: "workspace" }, snapshot }),
    ).toBeUndefined();
  });
});
