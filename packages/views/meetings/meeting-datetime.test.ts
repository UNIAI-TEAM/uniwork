import { describe, expect, it } from "vitest";
import { formatRemaining } from "./meeting-datetime";

describe("formatRemaining", () => {
  it("returns a padded H:MM:SS countdown", () => {
    const now = Date.parse("2026-08-28T00:00:00Z");
    expect(formatRemaining("2026-08-29T07:12:30Z", now)).toBe("31:12:30");
  });

  it("clamps to zero after the meeting has ended", () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    expect(formatRemaining("2026-08-28T11:00:00Z", now)).toBe("00:00:00");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatRemaining("not-a-date")).toBeNull();
  });
});
