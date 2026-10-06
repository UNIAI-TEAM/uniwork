import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createCharacterCommands, FONT_STEP_COALESCE_MS } from "./character";

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const editor = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(editor);
  return editor;
}

function withFakeTimers(run: () => void): void {
  vi.useFakeTimers();
  try {
    run();
  } finally {
    vi.useRealTimers();
  }
}

function areaWith(editor: Editor | null) {
  return createCharacterCommands({ getEditor: () => editor });
}

function styleAttrs(editor: Editor): Record<string, unknown> {
  return editor.getAttributes("docTextStyle") as Record<string, unknown>;
}

function markNamesAt(editor: Editor, pos: number): string[] {
  return (editor.state.doc.nodeAt(pos)?.marks ?? []).map((mark) => mark.type.name);
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("createCharacterCommands: state mapping", () => {
  it("reports the empty state before a document opens", () => {
    const area = areaWith(null);
    expect(area.readState(null)).toEqual({
      strike: false,
      verticalAlign: null,
      fontFamily: null,
      fontSizePt: null,
      color: null,
      highlight: null,
    });
    expect(area.commands.documentFonts()).toEqual([]);
    expect(area.commands.copyCharacterFormat()).toBe(false);
    expect(area.commands.applyCharacterFormat()).toBe(false);
  });

  it("maps the caret's marks and character attrs into the state", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.toggleStrike();
    area.commands.setVerticalAlign("superscript");
    area.commands.setFontFamily("Arial");
    area.commands.setFontSizePt(14.5);
    area.commands.setTextColor("ff0000");
    area.commands.setHighlight("yellow");
    editor.commands.setTextSelection(3);
    expect(area.readState(editor)).toEqual({
      strike: true,
      verticalAlign: "superscript",
      fontFamily: "Arial",
      fontSizePt: 14.5,
      color: "FF0000",
      highlight: "yellow",
    });
  });

  it("reads the font slot matching the text at the caret", () => {
    const cjk = editorWith("汉字测试");
    const cjkArea = areaWith(cjk);
    cjk.commands.setTextSelection({ from: 1, to: 5 });
    cjk.chain().setMark("docTextStyle", { font: "宋体", fontAscii: "Arial" }).run();
    cjk.commands.setTextSelection(3);
    expect(cjkArea.readState(cjk).fontFamily).toBe("宋体");

    const latin = editorWith("hello world");
    const latinArea = areaWith(latin);
    latin.commands.setTextSelection({ from: 1, to: 6 });
    latin.chain().setMark("docTextStyle", { font: "宋体", fontAscii: "Arial" }).run();
    latin.commands.setTextSelection(3);
    expect(latinArea.readState(latin).fontFamily).toBe("Arial");
  });
});

describe("createCharacterCommands: commands", () => {
  it("toggles strike and reads the active mark back", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.toggleStrike();
    expect(markNamesAt(editor, 1)).toContain("strike");
    expect(area.readState(editor).strike).toBe(true);
    area.commands.toggleStrike();
    expect(markNamesAt(editor, 1)).not.toContain("strike");
    expect(area.readState(editor).strike).toBe(false);
  });

  it("sets vertical align and clears it with null", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setVerticalAlign("superscript");
    expect(styleAttrs(editor).vertAlign).toBe("superscript");
    area.commands.setVerticalAlign("subscript");
    expect(styleAttrs(editor).vertAlign).toBe("subscript");
    area.commands.setVerticalAlign(null);
    expect(styleAttrs(editor).vertAlign ?? null).toBeNull();
  });

  it("targets the Latin slot for Latin names and the East-Asian slot for CJK names", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setFontFamily("Arial");
    expect(styleAttrs(editor).fontAscii).toBe("Arial");
    expect(styleAttrs(editor).font ?? null).toBeNull();
    area.commands.setFontFamily("宋体");
    expect(styleAttrs(editor).font).toBe("宋体");
    expect(styleAttrs(editor).fontAscii).toBe("Arial");
    area.commands.setFontFamily(null);
    expect(styleAttrs(editor).font ?? null).toBeNull();
    expect(styleAttrs(editor).fontAscii ?? null).toBeNull();
  });

  it("stores the font size in half points and rejects invalid input", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setFontSizePt(14.5);
    expect(styleAttrs(editor).sizeHalfPoints).toBe(29);
    expect(area.readState(editor).fontSizePt).toBe(14.5);
    area.commands.setFontSizePt(Number.NaN);
    area.commands.setFontSizePt(0);
    expect(styleAttrs(editor).sizeHalfPoints).toBe(29);
    area.commands.setFontSizePt(null);
    expect(styleAttrs(editor).sizeHalfPoints ?? null).toBeNull();
  });

  it("steps through Word's preset sizes from the default when the caret is unsized", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    withFakeTimers(() => {
      area.commands.stepFontSize(1);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(24);
      // A second click inside the window only moves the pending target; the
      // burst applies once, on the trailing edge.
      area.commands.stepFontSize(1);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(24);
      vi.advanceTimersByTime(FONT_STEP_COALESCE_MS);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(28);
      area.commands.stepFontSize(-1);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(24);
    });
  });

  it("coalesces a burst of steps into one trailing apply", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    withFakeTimers(() => {
      area.commands.stepFontSize(1);
      area.commands.stepFontSize(1);
      area.commands.stepFontSize(1);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(24);
      vi.advanceTimersByTime(FONT_STEP_COALESCE_MS);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(32);
    });
  });

  it("drops a pending step when the selection moved before the trailing apply", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    withFakeTimers(() => {
      area.commands.stepFontSize(1);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(24);
      editor.commands.setTextSelection({ from: 7, to: 12 });
      vi.advanceTimersByTime(FONT_STEP_COALESCE_MS);
      // The pending 14pt never lands on the new selection.
      expect(markNamesAt(editor, 7)).not.toContain("docTextStyle");
    });
  });

  it("does not overwrite a size set another way while a step is pending", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    withFakeTimers(() => {
      area.commands.stepFontSize(1);
      area.commands.setFontSizePt(24);
      vi.advanceTimersByTime(FONT_STEP_COALESCE_MS);
      expect(styleAttrs(editor).sizeHalfPoints).toBe(48);
    });
  });

  it("normalises colour input and clears to automatic", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setTextColor("#ff0000");
    expect(styleAttrs(editor).color).toBe("FF0000");
    expect(area.readState(editor).color).toBe("FF0000");
    area.commands.setTextColor("not-a-colour");
    expect(styleAttrs(editor).color).toBe("FF0000");
    area.commands.setTextColor(null);
    expect(styleAttrs(editor).color ?? null).toBeNull();
  });

  it("sets and clears the OOXML highlight", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setHighlight("yellow");
    expect(styleAttrs(editor).highlight).toBe("yellow");
    expect(area.readState(editor).highlight).toBe("yellow");
    area.commands.setHighlight(null);
    expect(styleAttrs(editor).highlight ?? null).toBeNull();
  });

  it("clears character formatting but keeps semantic marks", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.chain().setMark("link", { href: "https://uniwork.vn" }).run();
    area.commands.toggleStrike();
    area.commands.setFontFamily("Arial");
    area.commands.setTextColor("ff0000");
    area.commands.clearCharacterFormatting();
    const marks = markNamesAt(editor, 1);
    expect(marks).toContain("link");
    expect(marks).not.toContain("strike");
    expect(marks).not.toContain("docTextStyle");
  });

  it("rewrites the selection's case, keeping its marks", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.toggleStrike();
    area.commands.changeCase("upper");
    expect(editor.state.doc.textBetween(1, 6)).toBe("HELLO");
    expect(markNamesAt(editor, 1)).toContain("strike");
    area.commands.changeCase("title");
    expect(editor.state.doc.textBetween(1, 6)).toBe("Hello");
  });

  it("walks Word's toggle ring from the selection's text", () => {
    const editor = editorWith("hello");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.changeCase("toggle");
    expect(editor.state.doc.textBetween(1, 6)).toBe("HELLO");
    area.commands.changeCase("toggle");
    expect(editor.state.doc.textBetween(1, 6)).toBe("Hello");
    area.commands.changeCase("toggle");
    expect(editor.state.doc.textBetween(1, 6)).toBe("hello");
  });

  it("leaves a collapsed selection's case untouched", () => {
    const editor = editorWith("hello");
    const area = areaWith(editor);
    editor.commands.setTextSelection(3);
    area.commands.changeCase("upper");
    expect(editor.state.doc.textBetween(1, 6)).toBe("hello");
  });

  it("collects the document's explicit run fonts in first-seen order", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.setFontFamily("Arial");
    editor.commands.setTextSelection({ from: 7, to: 12 });
    area.commands.setFontFamily("Times New Roman");
    expect(area.commands.documentFonts()).toEqual(["Arial", "Times New Roman"]);
  });
});

describe("createCharacterCommands: format painter", () => {
  it("copies the caret's character formatting and applies it to the next selection", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.toggleStrike();
    area.commands.setFontFamily("Arial");
    editor.commands.setTextSelection(3);
    expect(area.commands.copyCharacterFormat()).toBe(true);
    editor.commands.setTextSelection({ from: 7, to: 12 });
    expect(area.commands.applyCharacterFormat()).toBe(true);
    expect(markNamesAt(editor, 7)).toContain("strike");
    expect(styleAttrs(editor).fontAscii).toBe("Arial");
    expect(area.commands.applyCharacterFormat()).toBe(false);
  });

  it("picks up only the first run's formatting from a range", () => {
    const editor = editorWith("bold plain");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.chain().toggleMark("bold").run();
    editor.commands.setTextSelection({ from: 1, to: 11 });
    area.commands.copyCharacterFormat();
    editor.commands.setTextSelection({ from: 6, to: 11 });
    area.commands.applyCharacterFormat();
    expect(markNamesAt(editor, 6)).toContain("bold");
  });

  it("paints plain formatting over a formatted target", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 7, to: 12 });
    area.commands.toggleStrike();
    editor.commands.setTextSelection(1);
    area.commands.copyCharacterFormat();
    editor.commands.setTextSelection({ from: 7, to: 12 });
    area.commands.applyCharacterFormat();
    expect(markNamesAt(editor, 7)).not.toContain("strike");
  });

  it("drops a capture without applying it", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    area.commands.toggleStrike();
    editor.commands.setTextSelection(3);
    area.commands.copyCharacterFormat();
    area.commands.clearCharacterFormat();
    editor.commands.setTextSelection({ from: 7, to: 12 });
    expect(area.commands.applyCharacterFormat()).toBe(false);
    expect(markNamesAt(editor, 7)).not.toContain("strike");
  });

  it("brushes the sentence under a bare click and restores the caret", () => {
    const editor = editorWith("One. Two three.");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.chain().toggleMark("bold").run();
    editor.commands.setTextSelection(2);
    area.commands.copyCharacterFormat();

    // The click collapses into the second sentence ("Two three.", offsets 5-14).
    editor.commands.setTextSelection(7);
    expect(area.commands.applyCharacterFormat()).toBe(true);
    expect(markNamesAt(editor, 6)).toContain("bold");
    expect(markNamesAt(editor, 12)).toContain("bold");
    // The space between the sentences belongs to the first one and stays plain.
    expect(markNamesAt(editor, 5)).not.toContain("bold");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(7);
  });
});

describe("createCharacterCommands: read-only handling", () => {
  it("refuses every command on a read-only editor", () => {
    const editor = editorWith("hello world");
    const area = areaWith(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.setEditable(false);
    area.commands.toggleStrike();
    area.commands.setVerticalAlign("superscript");
    area.commands.setFontFamily("Arial");
    area.commands.setFontSizePt(14);
    area.commands.setTextColor("ff0000");
    area.commands.setHighlight("yellow");
    area.commands.changeCase("upper");
    area.commands.clearCharacterFormatting();
    expect(editor.isActive("strike")).toBe(false);
    expect(styleAttrs(editor)).toEqual({});
    expect(editor.state.doc.textBetween(1, 6)).toBe("hello");
    expect(area.commands.copyCharacterFormat()).toBe(false);
    expect(area.commands.clearCharacterFormat()).toBeUndefined();
    expect(area.commands.applyCharacterFormat()).toBe(false);
  });
});
