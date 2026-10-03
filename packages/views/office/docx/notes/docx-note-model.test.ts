import { describe, expect, it } from "vitest";
import type { DocxNoteInfo } from "@uniwork/office-engine/docx";
import { editedNote, nextNoteId, noteNumberOf, noteNumbersOf } from "./docx-note-model";

const NOTES: DocxNoteInfo[] = [
  { id: "1", text: "one" },
  { id: "3", text: "three", richParas: [[{ text: "three", bold: true }]] },
];

describe("docx note rules", () => {
  it("allocates the smallest unused numeric id", () => {
    expect(nextNoteId(NOTES)).toBe("4");
    expect(nextNoteId([])).toBe("1");
    expect(nextNoteId([{ id: "abc", text: "x" }])).toBe("1");
  });

  it("numbers the pane badge by part order", () => {
    expect(noteNumberOf(NOTES, "3")).toBe(2);
    expect(noteNumberOf(NOTES, "404")).toBe(0);
  });

  it("numbers markers at the first body reference from numStart (noteNumbersOf parity)", () => {
    // part order would give 1 -> 1 and 3 -> 2; reference order wins
    expect([...noteNumbersOf(["3", "1"], NOTES).entries()]).toEqual([
      ["1", 2],
      ["3", 1],
    ]);
    // numStart offsets the first reference and a repeated reference keeps its number
    expect([...noteNumbersOf(["3", "1", "3"], NOTES, 5).entries()]).toEqual([
      ["1", 6],
      ["3", 5],
    ]);
    // an unreferenced note keeps its part-order slot
    expect([...noteNumbersOf(["1"], NOTES, 4).entries()]).toEqual([
      ["1", 4],
      ["3", 2],
    ]);
    // a reference to a note the part does not know is not counted
    expect([...noteNumbersOf(["404", "3"], NOTES, 2).entries()]).toEqual([
      ["1", 1],
      ["3", 2],
    ]);
  });

  it("drops rich runs on a text edit so the rebuild cannot revert it", () => {
    const next = editedNote(NOTES[1]!, "rewritten");
    expect(next.text).toBe("rewritten");
    expect(next.richParas).toBeUndefined();
    // the caller's entry is left alone
    expect(NOTES[1]!.richParas).toEqual([[{ text: "three", bold: true }]]);
  });
});
