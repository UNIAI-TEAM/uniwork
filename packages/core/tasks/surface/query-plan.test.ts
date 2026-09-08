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
});
