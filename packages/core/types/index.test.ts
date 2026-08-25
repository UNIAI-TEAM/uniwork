import { describe, expect, it } from "vitest";
import { TaskSchema, UserSchema } from "./index";

describe("schemas", () => {
  it("parses a task from the API", () => {
    const task = TaskSchema.parse({
      id: "01ABC", workspace_id: "01WS", title: "Việc",
      description: "", status: "todo", priority: "medium",
      position: 1024, created_by: "01U",
      created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
    });
    expect(task.assignee_id).toBeUndefined();
  });
  it("rejects unknown status", () => {
    expect(() =>
      TaskSchema.parse({
        id: "x", workspace_id: "w", title: "t", description: "",
        status: "weird", priority: "medium", position: 0, created_by: "u",
        created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
      }),
    ).toThrow();
  });
  it("parses user", () => {
    expect(UserSchema.parse({ id: "u", email: "a@b.c", display_name: "A" }).display_name).toBe("A");
  });
});
