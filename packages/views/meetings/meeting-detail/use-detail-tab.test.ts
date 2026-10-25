import { describe, expect, it } from "vitest";
import { resolveDetailTab } from "./use-detail-tab";

const ended = ["overview", "transcript", "minutes"] as const;

describe("resolveDetailTab", () => {
  it("opens the first tab by default, and none on a page without tabs", () => {
    expect(resolveDetailTab(ended, {})).toBe("overview");
    expect(resolveDetailTab(["notes", "transcript"], {})).toBe("notes");
    expect(resolveDetailTab([], { tab: "transcript" })).toBeNull();
  });

  it("follows ?tab=, but never to a tab the viewer does not have", () => {
    expect(resolveDetailTab(ended, { tab: "minutes" })).toBe("minutes");
    expect(resolveDetailTab(["overview", "minutes"], { tab: "transcript" })).toBe("overview");
  });

  it("maps a ?section= deep link to the tab that holds it", () => {
    expect(resolveDetailTab(ended, { section: "transcript" })).toBe("transcript");
    expect(resolveDetailTab(ended, { section: "minutes" })).toBe("minutes");
    expect(resolveDetailTab(ended, { section: "action-items" })).toBe("overview");
    expect(resolveDetailTab(ended, { section: "nonsense" })).toBe("overview");
  });

  it("opens the transcript at a cited ?segment=", () => {
    expect(resolveDetailTab(ended, { segment: "s1" })).toBe("transcript");
    expect(resolveDetailTab(["overview"], { segment: "s1" })).toBe("overview");
    // An explicit tab wins over the segment.
    expect(resolveDetailTab(ended, { tab: "minutes", segment: "s1" })).toBe("minutes");
  });
});
