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

  it("uses full light tints while keeping dark columns restrained", () => {
    for (const config of Object.values(STATUS_CONFIG)) {
      expect(config.columnBg).toMatch(/^bg-tint-[a-z]+ dark:bg-tint-[a-z]+\/35$/);
      expect(config.columnBg).not.toMatch(/^bg-tint-[a-z]+\/35/);
    }
  });
});
