import { describe, expect, it } from "vitest";
import { planSurfaceQuery } from "./query-plan";

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

  it("keeps my scope on my_tasks even when viewMode is table", () => {
    const plan = planSurfaceQuery({
      scope: { type: "my", userId: "u1", relation: "all" },
      viewMode: "table",
    });
    expect(plan.kind).toBe("my_tasks");
    expect(plan.tableBody).toBeUndefined();
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
