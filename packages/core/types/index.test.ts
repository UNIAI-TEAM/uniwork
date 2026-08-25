import { describe, expect, it } from "vitest";
import { TaskSchema, UserSchema } from "./index";
import { TaskSchema as TaskFromDomain } from "./task";
import { WS_EVENT_TYPES, WorkspaceEventSchema } from "./events";

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

  it("lets an unknown status through instead of throwing", () => {
    // Response schemas are lenient on purpose: a server that ships a new
    // status must degrade to "this row renders in no column", not to a white
    // screen. Switches over status carry a default branch for exactly this.
    const task = TaskSchema.parse({
      id: "x", workspace_id: "w", title: "t", description: "",
      status: "archived", priority: "medium", position: 0, created_by: "u",
      created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
    });
    expect(task.status).toBe("archived");
  });

  it("parses user", () => {
    expect(UserSchema.parse({ id: "u", email: "a@b.c", display_name: "A" }).display_name).toBe("A");
  });

  it("re-exports the domain modules", () => {
    expect(TaskFromDomain).toBe(TaskSchema);
  });

  it("names the realtime event types the server emits", () => {
    expect(WS_EVENT_TYPES).toContain("task.updated");
    expect(WorkspaceEventSchema.safeParse({ type: "task.created", payload: {} }).success).toBe(true);
    expect(WorkspaceEventSchema.safeParse({ type: 42 }).success).toBe(false);
  });
});
