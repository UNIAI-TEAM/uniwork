import { Editor, type JSONContent } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createDocxPasteOptionsController, useDocxPasteOptions, type DocxPasteChipState } from "./use-docx-paste-options";

const editors: Editor[] = [];

function createEditor(content: JSONContent): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content });
  editors.push(editor);
  return editor;
}

const paragraphDoc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "docParagraph", content: [{ type: "text", text }] }],
});

function textMarks(editor: Editor, needle: string): string[] {
  const marks: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === needle) marks.push(...node.marks.map((mark) => mark.type.name));
    return true;
  });
  return marks;
}

function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(Math.max(1, editor.state.doc.content.size - 1));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("createDocxPasteOptionsController", () => {
  it("opens on the paste's document change and anchors at the changed range", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);
    const states: Array<DocxPasteChipState | null> = [];
    const unsubscribe = controller.subscribe((state) => states.push(state));

    caretAtEnd(editor);
    controller.notePaste({ html: "", text: "Pasted" });
    editor.chain().insertContent("Pasted").run();

    const chip = controller.getState();
    expect(chip).not.toBeNull();
    expect(chip?.mode).toBe("source");
    expect(editor.state.doc.textBetween(chip?.range.from ?? 0, chip?.range.to ?? 0)).toBe("Pasted");
    expect(states.at(-1)).toEqual(chip);

    unsubscribe();
    controller.dispose();
  });

  it("ignores typing and dismisses on a later document change", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);

    caretAtEnd(editor);
    editor.chain().insertContent("typed").run();
    expect(controller.getState()).toBeNull();

    controller.notePaste({ html: "", text: "x" });
    editor.chain().insertContent("x").run();
    const chip = controller.getState();
    expect(chip).not.toBeNull();

    editor.chain().insertContent("more").run();
    expect(controller.getState()).toBeNull();

    controller.dispose();
  });

  it("keeps no chip for a payload without prose", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);
    caretAtEnd(editor);
    controller.notePaste(null);
    editor.chain().insertContent("x").run();
    expect(controller.getState()).toBeNull();
    controller.dispose();
  });

  it("applies the chosen mode to the pasted range and dismisses", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);
    caretAtEnd(editor);
    controller.notePaste({ html: "", text: "styled" });
    editor
      .chain()
      .insertContent({ type: "text", text: "styled", marks: [{ type: "docTextStyle", attrs: { color: "FF0000" } }] })
      .run();
    expect(controller.getState()).not.toBeNull();
    expect(textMarks(editor, "styled")).toEqual(["docTextStyle"]);

    controller.apply("merge");
    expect(controller.getState()).toBeNull();
    expect(textMarks(editor, "styled")).toEqual([]);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe("Bodystyled");

    controller.dispose();
  });

  it("dismisses without touching the document", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);
    caretAtEnd(editor);
    controller.notePaste({ html: "", text: "x" });
    editor.chain().insertContent("x").run();
    const before = editor.state.doc.textBetween(0, editor.state.doc.content.size);

    controller.dismiss();
    expect(controller.getState()).toBeNull();
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(before);
    controller.dispose();
  });

  it("refreshes the anchor without dismissing", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const controller = createDocxPasteOptionsController(editor);
    const coords = vi
      .spyOn(editor.view, "coordsAtPos")
      .mockReturnValue({ left: 10, right: 20, top: 30, bottom: 40 });

    caretAtEnd(editor);
    controller.notePaste({ html: "", text: "x" });
    editor.chain().insertContent("x").run();
    expect(controller.getState()?.position).toEqual({ left: 26, top: 46 });

    coords.mockReturnValue({ left: 100, right: 120, top: 130, bottom: 140 });
    controller.refreshPosition();
    expect(controller.getState()?.position).toEqual({ left: 126, top: 146 });
    coords.mockRestore();
    controller.dispose();
  });
});

describe("useDocxPasteOptions", () => {
  it("tracks the chip through the hook and dismisses it", () => {
    const editor = createEditor(paragraphDoc("Body"));
    const { result } = renderHook(() => useDocxPasteOptions(editor));
    expect(result.current.chip).toBeNull();

    act(() => {
      result.current.notePaste({ html: "", text: "x" });
      editor.chain().insertContent("x").run();
    });
    expect(result.current.chip).not.toBeNull();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.chip).toBeNull();
  });
});
