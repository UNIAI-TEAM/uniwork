import { describe, expect, it } from "vitest";
import { STATUS_CONFIG, statusColumnBg } from "./status-config";

describe("status-config", () => {
  it("exposes chrome for every catalog status", () => {
    expect(Object.keys(STATUS_CONFIG).sort()).toEqual(
      [
        "backlog",
        "blocked",
        "cancelled",
        "done",
        "in_progress",
        "in_review",
        "todo",
      ].sort(),
    );
    expect(STATUS_CONFIG.blocked.iconColor).toContain("destructive");
  });

  it("falls back for unknown status strings", () => {
    expect(statusColumnBg("todo")).toBe(STATUS_CONFIG.todo.columnBg);
    expect(statusColumnBg("not-a-status")).toBe("bg-muted/40");
  });
});
