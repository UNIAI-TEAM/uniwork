import { describe, expect, it } from "vitest";
import {
  addSectionEdit,
  addSlideEdit,
  compactEdits,
  deleteSlideEdit,
  duplicateSlideEdit,
  moveSectionEdit,
  moveSlideEdit,
  removeSectionEdit,
  renameSectionEdit,
  setSlideHiddenEdit,
} from "./sorter-edits";

/**
 * These pin the wire shape: each builder must emit the exact `PptxEdit` kind the
 * engine half registered (`PPTX_EDIT_REGISTRY` in
 * packages/office-engine/src/pptx/model.ts), with the field names the vendored
 * op builders read. A drift here is an "unsupported_edit" refusal at runtime, so
 * the assertions name the op and its keys explicitly.
 */
describe("sorter edit builders", () => {
  it("builds the slide lifecycle edits the registry knows", () => {
    expect(addSlideEdit(2, 0)).toEqual({ op: "add_slide_with_layout", layout: 2, slideIndex: 0 });
    expect(duplicateSlideEdit(1)).toEqual({ op: "duplicate_slide", slideIndex: 1 });
    expect(deleteSlideEdit(3)).toEqual({ op: "delete_slide", slideIndex: 3 });
    expect(setSlideHiddenEdit(0, true)).toEqual({ op: "set_slide_hidden", slideIndex: 0, hidden: true });
    expect(setSlideHiddenEdit(0, false)).toEqual({ op: "set_slide_hidden", slideIndex: 0, hidden: false });
  });

  it("maps a drag to move_slide and refuses a no-op", () => {
    expect(moveSlideEdit(0, 2, 3)).toEqual({ op: "move_slide", slideIndex: 0, toIndex: 2 });
    expect(moveSlideEdit(1, 1, 3)).toBeNull();
    expect(moveSlideEdit(0, 9, 3)).toBeNull();
  });

  it("builds the five section edits and trims the name", () => {
    expect(addSectionEdit(1, "  Agenda  ")).toEqual({ op: "add_section", atSlideIndex: 1, name: "Agenda" });
    expect(renameSectionEdit("sec-1", "  Close  ")).toEqual({ op: "rename_section", id: "sec-1", name: "Close" });
    expect(removeSectionEdit("sec-1")).toEqual({ op: "remove_section", id: "sec-1" });
    expect(moveSectionEdit("sec-1", "up")).toEqual({ op: "move_section", id: "sec-1", dir: "up" });
    expect(moveSectionEdit("sec-1", "down")).toEqual({ op: "move_section", id: "sec-1", dir: "down" });
  });

  it("refuses input the engine would reject instead of sending a bad op", () => {
    expect(addSlideEdit(-1, 0)).toBeNull();
    expect(addSlideEdit(0, -1)).toBeNull();
    expect(duplicateSlideEdit(-1)).toBeNull();
    expect(deleteSlideEdit(1.5)).toBeNull();
    expect(addSectionEdit(0, "   ")).toBeNull();
    expect(addSectionEdit(-1, "Agenda")).toBeNull();
    expect(renameSectionEdit("", "Close")).toBeNull();
    expect(renameSectionEdit("sec-1", "  ")).toBeNull();
    expect(removeSectionEdit("")).toBeNull();
    expect(moveSectionEdit("", "up")).toBeNull();
  });

  it("drops the refused builders from a compacted list", () => {
    expect(compactEdits([moveSlideEdit(0, 1, 2), moveSlideEdit(0, 0, 2), deleteSlideEdit(0)])).toEqual([
      { op: "move_slide", slideIndex: 0, toIndex: 1 },
      { op: "delete_slide", slideIndex: 0 },
    ]);
    expect(compactEdits([])).toEqual([]);
  });
});