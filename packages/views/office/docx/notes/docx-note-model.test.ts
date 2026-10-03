import { describe, expect, it } from "vitest";
import type { DocxNoteInfo } from "@uniwork/office-engine/docx";
import { editedNote, nextNoteId, noteNumberOf, noteNumbers } from "./docx-note-model";

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

  it("numbers notes by part order", () => {
    expect(noteNumberOf(NOTES, "3")).toBe(2);
    expect(noteNumberOf(NOTES, "404")).toBe(0);
    expect([...noteNumbers(NOTES).entries()]).toEqual([
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
