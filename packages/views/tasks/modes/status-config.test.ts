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
    expect(STATUS_CONFIG.blocked.tone).toBe("red");
    expect(STATUS_CONFIG.done.tone).toBe("green");
  });

  it("falls back for unknown status strings", () => {
    expect(statusColumnBg("todo")).toBe(STATUS_CONFIG.todo.columnBg);
    expect(statusColumnBg("not-a-status")).toBe("bg-muted/20");
  });

  it("uses semantic column backgrounds", () => {
    expect(STATUS_CONFIG.backlog.columnBg).toBe("bg-muted/40");
    expect(STATUS_CONFIG.todo.columnBg).toBe("bg-muted/40");
    expect(STATUS_CONFIG.cancelled.columnBg).toBe("bg-muted/40");
    expect(STATUS_CONFIG.in_progress.columnBg).toBe("bg-warning/5");
    expect(STATUS_CONFIG.in_review.columnBg).toBe("bg-success/5");
    expect(STATUS_CONFIG.done.columnBg).toBe("bg-info/5");
    expect(STATUS_CONFIG.blocked.columnBg).toBe("bg-destructive/5");
  });
});
