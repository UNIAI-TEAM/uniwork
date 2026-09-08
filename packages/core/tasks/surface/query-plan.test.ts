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
