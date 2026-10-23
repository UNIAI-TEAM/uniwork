import { describe, expect, it } from "vitest";
import { absoluteTime, relativeTime } from "./relative-time";

const now = new Date("2026-09-25T10:00:00Z");

describe("relativeTime", () => {
  it("reads as a distance inside the last week", () => {
    expect(relativeTime("2026-09-25T09:55:00Z", "en", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-09-25T09:59:40Z", "en", now)).toBe("now");
    expect(relativeTime("2026-09-23T10:00:00Z", "en", now)).toBe("2 days ago");
  });

  it("gives the date past a week, with the year only when it differs", () => {
    expect(relativeTime("2026-09-12T10:00:00Z", "en", now)).toBe("Sep 12");
    expect(relativeTime("2025-12-30T10:00:00Z", "en", now)).toBe("Dec 30, 2025");
  });

  it("is empty for an unreadable timestamp", () => {
    expect(relativeTime("nope", "en", now)).toBe("");
    expect(absoluteTime("nope", "en")).toBe("");
  });
});
