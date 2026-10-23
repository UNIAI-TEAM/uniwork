import { describe, expect, it } from "vitest";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
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
    expect(STATUS_CONFIG.done.tone).toBe("blue");
  });

  it("colours glyph and column from its tone, so they never disagree", () => {
    for (const cfg of Object.values(STATUS_CONFIG)) {
      expect(cfg.iconColor).toBe(tintForegroundClass[cfg.tone]);
      expect(cfg.columnBg).toContain(`bg-tint-${cfg.tone}/`);
    }
  });

  it("falls back to the neutral plane for unknown status strings", () => {
    expect(statusColumnBg("done")).toBe(STATUS_CONFIG.done.columnBg);
    expect(statusColumnBg("not-a-status")).toBe("bg-muted/50 dark:bg-muted/20");
  });
});
