import { describe, expect, it } from "vitest";
import {
  MARKDOWN_BLOCK_STYLES,
  MARKDOWN_TOOLBAR_GROUPS,
  blockStyleOf,
  headingLevelOf,
  markdownToolbarControlIds,
} from "./groups";

describe("MARKDOWN_TOOLBAR_GROUPS", () => {
  it("declares the C7 order: block style, inline, link, lists, insert, view", () => {
    expect(MARKDOWN_TOOLBAR_GROUPS.map((group) => group.id)).toEqual([
      "blockStyle",
      "inline",
      "link",
      "lists",
      "insert",
      "view",
    ]);
  });

  it("declares every control exactly once, with no duplicate group id", () => {
    const ids = markdownToolbarControlIds();
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = MARKDOWN_TOOLBAR_GROUPS.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it("keeps undo, redo and save out of the command row", () => {
    const ids = markdownToolbarControlIds();
    // Undo/redo are the chrome's tab-row quick access (C6); Save is the shared
    // save cluster (C2, UNI-930). A duplicate here would be a second control.
    for (const forbidden of ["undo", "redo", "save", "viewSource", "viewWysiwyg"]) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it("gives every control a label key under the Markdown toolbar/wysiwyg prefix", () => {
    for (const group of MARKDOWN_TOOLBAR_GROUPS) {
      expect(group.labelKey.startsWith("office.markdown.toolbar.")).toBe(true);
      for (const control of group.controls) {
        expect(control.labelKey.startsWith("office.markdown.")).toBe(true);
      }
    }
  });

  it("collapses the pane toggles first and the writing commands last", () => {
    const priority = Object.fromEntries(MARKDOWN_TOOLBAR_GROUPS.map((group) => [group.id, group.priority])) as Record<string, number>;
    const at = (id: string) => priority[id] as number;
    expect(at("view")).toBeLessThan(at("insert"));
    expect(at("insert")).toBeLessThan(at("link"));
    expect(at("link")).toBeLessThan(at("lists"));
    expect(at("lists")).toBeLessThan(at("inline"));
    expect(at("inline")).toBeLessThan(at("blockStyle"));
  });

  it("has one compact block-style dropdown covering paragraph, H1-H6, quote and code", () => {
    const blockStyle = MARKDOWN_TOOLBAR_GROUPS.find((group) => group.id === "blockStyle");
    expect(blockStyle?.controls).toHaveLength(1);
    expect(blockStyle?.controls[0]?.id).toBe("blockStyle");
    expect(MARKDOWN_BLOCK_STYLES).toEqual([
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
      "quote",
      "code",
    ]);
  });
});

describe("headingLevelOf / blockStyleOf", () => {
  it("maps a style to its heading level and back", () => {
    expect(headingLevelOf("heading3")).toBe(3);
    expect(headingLevelOf("paragraph")).toBeNull();
    expect(headingLevelOf("quote")).toBeNull();
    expect(blockStyleOf(6)).toBe("heading6");
  });

  it("falls back to paragraph for a level the menu cannot name", () => {
    expect(blockStyleOf(0)).toBe("paragraph");
    expect(blockStyleOf(7)).toBe("paragraph");
    expect(blockStyleOf(null)).toBe("paragraph");
    expect(blockStyleOf(undefined)).toBe("paragraph");
  });
});
