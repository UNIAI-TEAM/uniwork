import { describe, expect, it } from "vitest";
import { PPTX_FIND_COMMAND, PPTX_QUICK_ACCESS_COMMANDS, PPTX_TAB_ROW_COMMANDS, PPTX_TOOLBAR_TABS, PPTX_VIEW_TOGGLE_COMMAND, computeToolbarOverflow, firstRovingIndex, nextRovingEnabledIndex, nextTabIndex, orderGroupsForNarrow, tabIsEmpty, toolbarCommandIds } from "./tabs";

describe("PPTX toolbar tab model", () => {
  it("lists the eight ribbon tabs in order", () => {
    expect(PPTX_TOOLBAR_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "insert",
      "design",
      "transitions",
      "animations",
      "slide-show",
      "review",
      "view",
    ]);
  });

  it("places every command id exactly once across the tab row and the tabs", () => {
    const ids = toolbarCommandIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("save");
    expect(ids).toContain("undo");
    expect(ids).toContain("redo");
    expect(ids).toContain("presenter");
    expect(ids).toContain("fullscreen");
    expect(ids).toContain("render-fidelity");
    expect(ids).toContain("find");
  });

  it("keeps undo/redo out of the tabs so the tab row owns them (C6)", () => {
    const tabOnly = PPTX_TOOLBAR_TABS.flatMap((tab) => tab.groups.flatMap((group) => [...group.commands]));
    expect(tabOnly).not.toContain("undo");
    expect(tabOnly).not.toContain("redo");
    expect(tabOnly).not.toContain("presenter");
    expect(PPTX_QUICK_ACCESS_COMMANDS).toEqual(["undo", "redo"]);
    expect(PPTX_VIEW_TOGGLE_COMMAND).toBe("presenter");
    expect(PPTX_FIND_COMMAND).toBe("find");
    expect(PPTX_TAB_ROW_COMMANDS).toEqual(["undo", "redo", "presenter", "find"]);
  });

  it("marks a tab with no commands as honestly empty", () => {
    const transitions = PPTX_TOOLBAR_TABS.find((tab) => tab.id === "transitions");
    expect(transitions).toBeDefined();
    expect(tabIsEmpty(transitions!)).toBe(true);
    expect(tabIsEmpty(PPTX_TOOLBAR_TABS.find((tab) => tab.id === "home")!)).toBe(false);
  });
});

describe("narrow command row order (C12)", () => {
  it("moves the tab's primary group first and keeps the rest in order", () => {
    const home = PPTX_TOOLBAR_TABS.find((tab) => tab.id === "home")!;
    const ordered = orderGroupsForNarrow(home.groups);
    expect(ordered.map((group) => group.id)).toEqual(["editing", "file"]);
    // Stable: an already-primary-first list is unchanged.
    expect(orderGroupsForNarrow(ordered).map((group) => group.id)).toEqual(["editing", "file"]);
  });

  it("keeps every group when none is primary", () => {
    const groups = [{ id: "file" as const, labelKey: "groups.file", commands: ["save" as const] }];
    expect(orderGroupsForNarrow(groups).map((group) => group.id)).toEqual(["file"]);
  });

  it("marks primary only where a tab genuinely has more than one group (F8)", () => {
    for (const tab of PPTX_TOOLBAR_TABS) {
      const flagged = tab.groups.filter((group) => group.primary);
      if (tab.groups.length > 1) {
        // A multi-group tab names exactly one group to lead the narrow strip.
        expect(flagged, `${tab.id} should name one primary group`).toHaveLength(1);
      } else {
        // A single-group tab is already first; `primary` documents nothing.
        expect(flagged, `${tab.id} must not flag its only group`).toHaveLength(0);
      }
    }
  });
});

describe("roving tab index", () => {
  it("wraps the tab strip and jumps with Home/End", () => {
    expect(nextTabIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextTabIndex(1, 3, "Home")).toBe(0);
    expect(nextTabIndex(1, 3, "End")).toBe(2);
    expect(nextTabIndex(0, 3, "Enter")).toBeNull();
    expect(nextTabIndex(0, 0, "ArrowRight")).toBeNull();
  });

  it("clamps group focus at the ends instead of wrapping", () => {
    const enabled = [true, true, true];
    expect(nextRovingEnabledIndex(0, enabled, "ArrowRight")).toBe(1);
    expect(nextRovingEnabledIndex(2, enabled, "ArrowRight")).toBe(2);
    expect(nextRovingEnabledIndex(0, enabled, "ArrowLeft")).toBe(0);
    expect(nextRovingEnabledIndex(1, enabled, "End")).toBe(2);
    expect(nextRovingEnabledIndex(1, enabled, "Tab")).toBeNull();
  });

  it("skips disabled controls the keyboard cannot focus", () => {
    const enabled = [true, false, true];
    expect(nextRovingEnabledIndex(0, enabled, "ArrowRight")).toBe(2);
    expect(nextRovingEnabledIndex(2, enabled, "ArrowLeft")).toBe(0);
    expect(nextRovingEnabledIndex(2, enabled, "ArrowRight")).toBe(2);
    expect(firstRovingIndex(enabled)).toBe(0);
    expect(firstRovingIndex([false, false, true])).toBe(2);
    expect(firstRovingIndex([false, false])).toBe(0);
  });
});

describe("toolbar overflow", () => {
  it("keeps every group when the row fits or is unmeasured", () => {
    expect(computeToolbarOverflow([100, 100], 300, 40)).toEqual({ visible: 2, overflow: 0 });
    expect(computeToolbarOverflow([100, 100], 0, 40)).toEqual({ visible: 2, overflow: 0 });
  });

  it("collapses trailing groups once the row is too narrow", () => {
    expect(computeToolbarOverflow([200, 200, 200], 460, 40)).toEqual({ visible: 2, overflow: 1 });
  });

  it("never collapses the whole row", () => {
    expect(computeToolbarOverflow([200, 200], 60, 40)).toEqual({ visible: 1, overflow: 1 });
  });
});
