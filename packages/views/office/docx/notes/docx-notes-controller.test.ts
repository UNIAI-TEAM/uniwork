// Controller tests over a real TipTap editor built from the vendored DOCX
// extensions: a note reference must land as the parser's own docNoteRef atom
// (run.noteRef round-trips as w:footnoteReference/w:endnoteReference), and a
// delete must strip the marker while the survivors renumber by part order.
import { Editor } from "@tiptap/core";
import { blocksToPmDoc, type RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocxNoteKind } from "@uniwork/office-engine/docx";
import { docxExtensions } from "../docx-schema";
import { createDocxNotesController } from "./docx-notes-controller";

const BLOCKS: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "hello world" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "second block" }] },
];

function createEditor(editable = true): Editor {
  return new Editor({ extensions: docxExtensions(), content: blocksToPmDoc(BLOCKS), editable });
}

/** Every note marker of a kind, document order. */
function refsOf(editor: Editor, kind: DocxNoteKind): Array<{ id: string; num: number }> {
  const out: Array<{ id: string; num: number }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "docNoteRef" || node.attrs.kind !== kind) return true;
    out.push({ id: String(node.attrs.id), num: Number(node.attrs.num) });
    return true;
  });
  return out;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.restoreAllMocks();
});

describe("docx notes controller", () => {
  it("seeds both lists with copies and clears the edit flags", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    const seeded = [{ id: "1", text: "seeded" }];
    controller.seed(seeded, [{ id: "2", text: "end" }]);
    seeded[0]!.text = "mutated";
    expect(controller.list("footnote")).toEqual([{ id: "1", text: "seeded" }]);
    expect(controller.list("endnote")).toEqual([{ id: "2", text: "end" }]);
    expect(controller.snapshot()).toEqual({
      footnotes: [{ id: "1", text: "seeded" }],
      endnotes: [{ id: "2", text: "end" }],
      edited: { footnote: false, endnote: false },
    });
  });

  it("inserts a marker at the caret and appends the list entry", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    editor.commands.setTextSelection(6);
    const note = controller.insert("footnote", "  a new note  ");
    expect(note).toEqual({ id: "1", text: "a new note" });
    expect(refsOf(editor, "footnote")).toEqual([{ id: "1", num: 1 }]);
    expect(controller.list("footnote")).toHaveLength(1);
    expect(controller.snapshot().edited).toEqual({ footnote: true, endnote: false });
    // the marker rides the text without splitting it into a saved text edit
    expect(editor.state.doc.firstChild?.textContent).toBe("hello world");
  });

  it("keeps footnote and endnote numbering apart", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    editor.commands.setTextSelection(6);
    controller.insert("endnote", "closing");
    editor.commands.setTextSelection(12);
    controller.insert("footnote", "first");
    editor.commands.setTextSelection(14);
    expect(controller.insert("footnote", "second")).toMatchObject({ id: "2" });
    expect(refsOf(editor, "footnote").map((r) => r.num)).toEqual([1, 2]);
    expect(refsOf(editor, "endnote").map((r) => r.num)).toEqual([1]);
  });

  it("refuses insert without an editable editor or with blank text", () => {
    editor = createEditor(true);
    const controller = createDocxNotesController(() => editor);
    expect(controller.insert("footnote", "   ")).toBeNull();
    editor.setEditable(false);
    expect(controller.canInsert()).toBe(false);
    expect(controller.insert("footnote", "nope")).toBeNull();
    expect(controller.list("footnote")).toEqual([]);
    const open = editor;
    editor = null;
    open.destroy();
    expect(controller.canInsert()).toBe(false);
  });

  it("refuses to insert with a live range selection (the marker would replace it)", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    editor.commands.selectAll();
    expect(controller.canInsert()).toBe(false);
    expect(controller.insert("footnote", "nope")).toBeNull();
    expect(controller.list("footnote")).toEqual([]);
    expect(refsOf(editor, "footnote")).toEqual([]);
  });

  it("edits a note's text and drops stale rich runs", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    controller.seed([{ id: "1", text: "old", richParas: [[{ text: "old", bold: true }]] }], []);
    expect(controller.setText("footnote", "1", "  new text  ")).toBe(true);
    expect(controller.list("footnote")[0]).toEqual({ id: "1", text: "new text" });
    expect(controller.snapshot().edited.footnote).toBe(true);
    expect(controller.setText("footnote", "1", "   ")).toBe(false);
    expect(controller.setText("footnote", "404", "x")).toBe(false);
  });

  it("deletes a note, strips its marker and renumbers the survivors", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    editor.commands.setTextSelection(6);
    controller.insert("footnote", "first");
    editor.commands.setTextSelection(12);
    controller.insert("footnote", "second");
    expect(controller.remove("footnote", "1")).toBe(true);
    expect(controller.list("footnote").map((n) => n.id)).toEqual(["2"]);
    expect(refsOf(editor, "footnote")).toEqual([{ id: "2", num: 1 }]);
    expect(controller.snapshot().edited.footnote).toBe(true);
    expect(controller.remove("footnote", "404")).toBe(false);
  });

  it("reports a missing reference and refuses the jump", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    controller.seed([{ id: "1", text: "orphan" }], []);
    expect(controller.hasRef("footnote", "1")).toBe(false);
    expect(controller.jump("footnote", "1")).toBe(false);
  });

  it("jumps to the marker and scrolls it into view", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    editor.commands.setTextSelection(6);
    controller.insert("endnote", "closing");
    expect(controller.hasRef("endnote", "1")).toBe(true);
    expect(controller.jump("endnote", "1")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("restore re-seeds the lists and their edit flags", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    controller.restore({
      footnotes: [{ id: "7", text: "restored" }],
      endnotes: [],
      edited: { footnote: true, endnote: false },
    });
    expect(controller.list("footnote")).toEqual([{ id: "7", text: "restored" }]);
    expect(controller.snapshot().edited).toEqual({ footnote: true, endnote: false });
  });

  it("bumps the revision only on an accepted list mutation", () => {
    editor = createEditor();
    const controller = createDocxNotesController(() => editor);
    controller.seed([], []);
    const seeded = controller.revision();
    expect(controller.setText("footnote", "404", "unknown")).toBe(false);
    expect(controller.setText("footnote", "1", "   ")).toBe(false);
    expect(controller.insert("footnote", "   ")).toBeNull();
    expect(controller.revision()).toBe(seeded);

    editor.commands.setTextSelection(6);
    expect(controller.insert("footnote", "one")).toMatchObject({ id: "1" });
    const afterInsert = controller.revision();
    expect(afterInsert).toBeGreaterThan(seeded);

    expect(controller.setText("footnote", "1", "edited")).toBe(true);
    const afterSetText = controller.revision();
    expect(afterSetText).toBeGreaterThan(afterInsert);

    expect(controller.remove("footnote", "1")).toBe(true);
    expect(controller.revision()).toBeGreaterThan(afterSetText);
    expect(controller.remove("footnote", "404")).toBe(false);
    expect(controller.revision()).toBe(afterSetText + 1);
  });

  it("numbers markers in body-reference order from the observed numStart", () => {
    editor = new Editor({
      extensions: docxExtensions(),
      content: blocksToPmDoc([
        { type: "paragraph", docxIndex: 0, runs: [{ text: "one" }, { text: "5", noteRef: { kind: "footnote", id: "2" } }] },
        { type: "paragraph", docxIndex: 1, runs: [{ text: "two" }, { text: "6", noteRef: { kind: "footnote", id: "1" } }] },
      ]),
      editable: true,
    });
    const controller = createDocxNotesController(() => editor);
    controller.seed([{ id: "1", text: "first" }, { id: "2", text: "second" }], []);
    // deleting the part-first note must renumber the survivor at the document's
    // own base (5), not to its part index (1)
    expect(controller.remove("footnote", "2")).toBe(true);
    expect(refsOf(editor, "footnote")).toEqual([{ id: "1", num: 5 }]);
  });

  it("renumbers the later markers when a new reference lands before them", () => {
    editor = new Editor({
      extensions: docxExtensions(),
      content: blocksToPmDoc([
        { type: "paragraph", docxIndex: 0, runs: [{ text: "one" }, { text: "5", noteRef: { kind: "footnote", id: "2" } }] },
        { type: "paragraph", docxIndex: 1, runs: [{ text: "two" }, { text: "6", noteRef: { kind: "footnote", id: "1" } }] },
      ]),
      editable: true,
    });
    const controller = createDocxNotesController(() => editor);
    controller.seed([{ id: "1", text: "first" }, { id: "2", text: "second" }], []);
    editor.commands.setTextSelection(1);
    expect(controller.insert("footnote", "new")).toMatchObject({ id: "3" });
    expect(refsOf(editor, "footnote")).toEqual([
      { id: "3", num: 5 },
      { id: "2", num: 6 },
      { id: "1", num: 7 },
    ]);
  });
});
