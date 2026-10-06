import { describe, expect, it } from "vitest";
import type { PptxSectionInfo } from "@uniwork/office-engine/pptx";
import {
  canMoveSection,
  clampSlideIndex,
  groupRangeLabel,
  keyboardReorderTarget,
  layoutPickerValue,
  nextSectionNumber,
  normalizeSectionName,
  reorderSlideTargets,
  sectionIdAtSlide,
  sorterSectionGroups,
  standardLayoutKey,
} from "./sorter-helpers";

const layouts = [
  { name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" },
  { name: "Title and Content", path: "ppt/slideLayouts/slideLayout2.xml" },
];

function section(id: string, name: string, slideIndices: number[]): PptxSectionInfo {
  return { id, name, slideIndices };
}

describe("sorter slide index math", () => {
  it("clamps an index into the deck and answers 0 for an empty deck", () => {
    expect(clampSlideIndex(5, 3)).toBe(2);
    expect(clampSlideIndex(-2, 3)).toBe(0);
    expect(clampSlideIndex(1, 3)).toBe(1);
    expect(clampSlideIndex(4, 0)).toBe(0);
    expect(clampSlideIndex(Number.NaN, 3)).toBe(0);
  });

  it("returns a move target only when the gesture really changes the order", () => {
    expect(reorderSlideTargets(0, 2, 3)).toEqual({ from: 0, to: 2 });
    expect(reorderSlideTargets(1, 1, 3)).toBeNull();
    expect(reorderSlideTargets(0, 3, 3)).toBeNull();
    expect(reorderSlideTargets(-1, 1, 3)).toBeNull();
    expect(reorderSlideTargets(0, 1, 1)).toBeNull();
    expect(reorderSlideTargets(0.5, 1, 3)).toBeNull();
  });

  it("steps the reorder by arrow key and refuses to leave the deck", () => {
    expect(keyboardReorderTarget(1, 4, "ArrowRight")).toBe(2);
    expect(keyboardReorderTarget(1, 4, "ArrowLeft")).toBe(0);
    expect(keyboardReorderTarget(1, 5, "ArrowDown", 3)).toBe(4);
    expect(keyboardReorderTarget(3, 5, "ArrowDown", 3)).toBeNull();
    expect(keyboardReorderTarget(0, 4, "ArrowLeft")).toBeNull();
    expect(keyboardReorderTarget(3, 4, "ArrowRight")).toBeNull();
    expect(keyboardReorderTarget(1, 4, "Enter")).toBeNull();
    expect(keyboardReorderTarget(0, 1, "ArrowRight")).toBeNull();
  });
});

describe("sorter sections delegate to the engine grouping rule", () => {
  it("keeps the unsectioned lead group and the [start, end) spans", () => {
    const groups = sorterSectionGroups([section("s2", "Second", [3])], 5);
    expect(groups).toEqual([
      { id: null, name: "", start: 0, end: 3 },
      { id: "s2", name: "Second", start: 3, end: 5 },
    ]);
  });

  it("reports the 1-based inclusive range of a group", () => {
    expect(groupRangeLabel({ id: "s1", name: "One", start: 1, end: 4 })).toEqual({ start: 2, end: 4 });
    expect(groupRangeLabel({ id: "s1", name: "One", start: 2, end: 2 })).toBeNull();
  });

  it("finds the section a slide belongs to and numbers the next section", () => {
    const sections = [section("s1", "One", [0]), section("s2", "Two", [2])];
    expect(sectionIdAtSlide(sections, 0)).toBe("s1");
    expect(sectionIdAtSlide(sections, 2)).toBe("s2");
    expect(sectionIdAtSlide(sections, 1)).toBeNull();
    expect(nextSectionNumber(sections, 4)).toBe(3);
    expect(nextSectionNumber([], 4)).toBe(1);
  });

  it("guards a section move at both ends of the list", () => {
    const sections = [section("s1", "One", [0]), section("s2", "Two", [1])];
    expect(canMoveSection(sections, "s1", "up")).toBe(false);
    expect(canMoveSection(sections, "s1", "down")).toBe(true);
    expect(canMoveSection(sections, "s2", "down")).toBe(false);
    expect(canMoveSection(sections, "missing", "up")).toBe(false);
  });
});

describe("sorter name + layout picker helpers", () => {
  it("trims a typed section name and refuses a blank one", () => {
    expect(normalizeSectionName("  Agenda  ")).toBe("Agenda");
    expect(normalizeSectionName("   ")).toBeNull();
    expect(normalizeSectionName("")).toBeNull();
  });

  it("sends a layout index and refuses one outside the catalog", () => {
    expect(layoutPickerValue(layouts, 0)).toBe(0);
    expect(layoutPickerValue(layouts, 1)).toBe(1);
    expect(layoutPickerValue(layouts, 2)).toBeNull();
    expect(layoutPickerValue(layouts, -1)).toBeNull();
  });

  it("maps the standard Office layout names to a copy key and leaves custom names alone", () => {
    expect(standardLayoutKey("Blank")).toBe("office.pptx.sorter.layout.blank");
    expect(standardLayoutKey("  title and CONTENT ")).toBe("office.pptx.sorter.layout.title_content");
    expect(standardLayoutKey("Quarterly KPI")).toBeNull();
  });
});
