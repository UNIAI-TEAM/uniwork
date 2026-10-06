import { describe, expect, it } from "vitest";
import { MARKDOWN_BLOCK_STYLES, MARKDOWN_GROUP_ROW_BREAK, MARKDOWN_TOOLBAR_GROUPS, blockStyleOf, headingLevelOf } from "./groups";

/** Every control id the command row declares, in row order. */
const controlIds = () => MARKDOWN_TOOLBAR_GROUPS.flatMap((group) => group.controls.map((control) => control.id));

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
    const ids = controlIds();
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = MARKDOWN_TOOLBAR_GROUPS.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it("keeps undo, redo and save out of the command row", () => {
    const ids = controlIds();
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

  it("declares icon-strip row breaks only for groups with no large primary (F4)", () => {
    // Office draws B I U S as equal icons, so the four-item inline group packs
    // 2 + 2 instead of one long run; the other groups are small enough to fit
    // one row or carry a labelled primary that anchors their column.
    expect(MARKDOWN_GROUP_ROW_BREAK).toEqual({ inline: ["strike"] });
    for (const [groupId, ids] of Object.entries(MARKDOWN_GROUP_ROW_BREAK)) {
      const group = MARKDOWN_TOOLBAR_GROUPS.find((candidate) => candidate.id === groupId)!;
      for (const id of ids) {
        expect(group.controls.some((control) => control.id === id), `${groupId}/${id}`).toBe(true);
      }
    }
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
