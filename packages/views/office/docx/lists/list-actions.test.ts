// B5 (UNI-924): the editor-side list operations — numbering-aware toggle,
// preset application, level stepping, restart and continue. The part edits go
// into the pending snapshot the command area owns; the body edits are real
// doc transactions.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { DocxNumberingDef } from "@uniwork/office-engine/docx";
import { docxExtensions } from "../docx-schema";
import {
  applyDocxListPreset,
  continueDocxListNumbering,
  readDocxListState,
  restartDocxListNumbering,
  setDocxListLevel,
  stepDocxListLevel,
  toggleDocxList,
} from "./list-actions";
import { listDefsOf, listPresetById, type DocxNumberingSnapshot } from "./list-numbering";

const editors: Editor[] = [];

const DEF7: DocxNumberingDef = {
  numId: "7",
  abstractNumId: "0",
  levels: { 0: { numFmt: "decimal", lvlText: "%1." }, 1: { numFmt: "decimal", lvlText: "%1.%2." } },
  startOverrides: {},
};

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text }] };
}

function listItem(text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type: "docListItem",
    attrs: { docxIndex: 0, kind: "ordered", numId: "7", ilvl: 0, ...attrs },
    content: [{ type: "text", text }],
  };
}

function editorWith(content: JSONContent[], defs: DocxNumberingDef[] = []): Editor {
  const numbering = new Map(defs.map((def) => [def.numId, def]));
  const editor = new Editor({ extensions: docxExtensions(numbering), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function blockAt(editor: Editor, index = 0) {
  return editor.state.doc.child(index);
}

function attrsAt(editor: Editor, index = 0): Record<string, unknown> {
  return blockAt(editor, index).attrs as Record<string, unknown>;
}

function caretInBlock(editor: Editor, index = 0): void {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += blockAt(editor, i).nodeSize;
  editor.commands.setTextSelection(pos + 2);
}

function selectAllBlocks(editor: Editor): void {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
}

const emptyPending = (): DocxNumberingSnapshot => ({ newDefs: [], restartNums: [] });

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("toggleDocxList", () => {
  it("reuses a same-kind definition through a restart num", () => {
    const editor = editorWith([paragraph("one")], [DEF7]);
    const pending = emptyPending();
    caretInBlock(editor);
    expect(toggleDocxList(editor, pending, "ordered")).toBe(true);
    expect(attrsAt(editor)).toMatchObject({ kind: "ordered", numId: "8", ilvl: 0 });
    expect(pending.newDefs).toEqual([]);
    expect(pending.restartNums).toEqual([{ numId: "8", abstractNumId: "0", startOverrides: { 0: 1 } }]);
    expect(listDefsOf(editor).get("8")).toMatchObject({ numId: "8", abstractNumId: "0", startOverrides: { 0: 1 } });
  });

  it("registers a blank-style definition when no same-kind def exists", () => {
    const editor = editorWith([paragraph("one")]);
    const pending = emptyPending();
    caretInBlock(editor);
    expect(toggleDocxList(editor, pending, "bullet")).toBe(true);
    expect(pending.newDefs).toEqual([{ numId: "3", kind: "bullet" }]);
    expect(attrsAt(editor)).toMatchObject({ kind: "bullet", numId: "3" });
    expect(listDefsOf(editor).get("3")).toMatchObject({ abstractNumId: "pending-3" });
  });

  it("returns a same-kind list item to a plain paragraph on the second toggle", () => {
    const editor = editorWith([paragraph("one")], [DEF7]);
    const pending = emptyPending();
    caretInBlock(editor);
    toggleDocxList(editor, pending, "ordered");
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(toggleDocxList(editor, pending, "ordered")).toBe(true);
    expect(blockAt(editor).type.name).toBe("docParagraph");
  });

  it("switches a list item to the other kind through a fresh num", () => {
    const editor = editorWith([listItem("one")], [DEF7]);
    const pending = emptyPending();
    caretInBlock(editor);
    toggleDocxList(editor, pending, "bullet");
    expect(attrsAt(editor)).toMatchObject({ kind: "bullet", numId: "8", ilvl: 0 });
    expect(pending.newDefs).toEqual([{ numId: "8", kind: "bullet" }]);
  });

  it("applies to every block the selection touches", () => {
    const editor = editorWith([paragraph("one"), paragraph("two")], [DEF7]);
    const pending = emptyPending();
    selectAllBlocks(editor);
    toggleDocxList(editor, pending, "bullet");
    expect(attrsAt(editor, 0).kind).toBe("bullet");
    expect(attrsAt(editor, 1).kind).toBe("bullet");
    expect(attrsAt(editor, 0).numId).toBe(attrsAt(editor, 1).numId);
  });

  it("refuses on a read-only editor", () => {
    const editor = editorWith([paragraph("one")]);
    caretInBlock(editor);
    const before = editor.getJSON();
    editor.setEditable(false);
    expect(toggleDocxList(editor, emptyPending(), "ordered")).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe("applyDocxListPreset", () => {
  it("registers the nine preset levels and converts the selection", () => {
    const editor = editorWith([paragraph("one"), paragraph("two")]);
    const pending = emptyPending();
    selectAllBlocks(editor);
    expect(applyDocxListPreset(editor, pending, listPresetById("multilevel-decimal")!)).toBe(true);
    expect(pending.newDefs).toHaveLength(1);
    expect(pending.newDefs[0]!.numId).toBe("3");
    expect(pending.newDefs[0]!.levels).toHaveLength(9);
    expect(pending.newDefs[0]!.levels?.[8]?.lvlText).toBe("1.1.1.1.1.1.1.1.1.");
    expect(attrsAt(editor, 0)).toMatchObject({ kind: "ordered", numId: "3", ilvl: 0 });
    expect(attrsAt(editor, 1).numId).toBe("3");
    expect(listDefsOf(editor).get("3")).toMatchObject({ abstractNumId: "pending-3" });
  });
});

describe("list levels", () => {
  it("sets the level of every selected list item and leaves paragraphs alone", () => {
    const editor = editorWith([listItem("one"), paragraph("body"), listItem("two", { ilvl: 3 })], [DEF7]);
    selectAllBlocks(editor);
    expect(setDocxListLevel(editor, 2)).toBe(true);
    expect(attrsAt(editor, 0).ilvl).toBe(2);
    expect(attrsAt(editor, 1).ilvl).toBeUndefined();
    expect(attrsAt(editor, 2).ilvl).toBe(2);
    expect(setDocxListLevel(editor, 9)).toBe(false);
    expect(setDocxListLevel(editor, 1.5)).toBe(false);
  });

  it("steps one level and clamps at the ends", () => {
    const editor = editorWith([listItem("one", { ilvl: 8 }), listItem("two", { ilvl: 0 })], [DEF7]);
    caretInBlock(editor, 0);
    expect(stepDocxListLevel(editor, 1)).toBe(false);
    expect(attrsAt(editor, 0).ilvl).toBe(8);
    expect(stepDocxListLevel(editor, -1)).toBe(true);
    expect(attrsAt(editor, 0).ilvl).toBe(7);
    caretInBlock(editor, 1);
    expect(stepDocxListLevel(editor, -1)).toBe(false);
    expect(stepDocxListLevel(editor, 1)).toBe(true);
    expect(attrsAt(editor, 1).ilvl).toBe(1);
  });
});

describe("restart and continue", () => {
  it("restarts at the caret's level and moves the later items to the new num", () => {
    const editor = editorWith([listItem("one"), listItem("two", { ilvl: 2 }), listItem("three")], [DEF7]);
    const pending = emptyPending();
    caretInBlock(editor, 1);
    expect(restartDocxListNumbering(editor, pending)).toBe(true);
    expect(pending.restartNums).toEqual([{ numId: "8", abstractNumId: "0", startOverrides: { 2: 1 } }]);
    expect(attrsAt(editor, 0).numId).toBe("7");
    expect(attrsAt(editor, 1).numId).toBe("8");
    expect(attrsAt(editor, 2).numId).toBe("8");
  });

  it("gives a definition-less item a fresh definition", () => {
    const editor = editorWith([listItem("one", { numId: "new-list-x" })]);
    const pending = emptyPending();
    caretInBlock(editor);
    expect(restartDocxListNumbering(editor, pending)).toBe(true);
    expect(pending.newDefs).toEqual([{ numId: "3", kind: "ordered" }]);
    expect(attrsAt(editor).numId).toBe("3");
  });

  it("does nothing outside a list or without a numId", () => {
    const editor = editorWith([paragraph("one")], [DEF7]);
    caretInBlock(editor);
    expect(restartDocxListNumbering(editor, emptyPending())).toBe(false);
    const noNum = editorWith([listItem("one", { numId: null })]);
    caretInBlock(noNum);
    expect(restartDocxListNumbering(noNum, emptyPending())).toBe(false);
  });

  it("continues into the previous list's numId", () => {
    const editor = editorWith([listItem("one"), listItem("two"), listItem("three", { numId: "9" })], [DEF7]);
    caretInBlock(editor, 2);
    expect(continueDocxListNumbering(editor)).toBe(true);
    expect(attrsAt(editor, 2).numId).toBe("7");
    expect(attrsAt(editor, 0).numId).toBe("7");
  });

  it("refuses to continue when no earlier list exists", () => {
    const editor = editorWith([listItem("one")], [DEF7]);
    caretInBlock(editor);
    expect(continueDocxListNumbering(editor)).toBe(false);
  });
});

describe("readDocxListState", () => {
  it("reads the caret's item and its definition levels", () => {
    const editor = editorWith([listItem("one", { ilvl: 1 })], [DEF7]);
    caretInBlock(editor);
    expect(readDocxListState(editor)).toEqual({
      kind: "ordered",
      numId: "7",
      ilvl: 1,
      levels: [
        { ilvl: 0, numFmt: "decimal", lvlText: "%1." },
        { ilvl: 1, numFmt: "decimal", lvlText: "%1.%2." },
      ],
    });
  });

  it("returns null outside a list item and before an editor exists", () => {
    const editor = editorWith([paragraph("one")]);
    caretInBlock(editor);
    expect(readDocxListState(editor)).toBeNull();
    expect(readDocxListState(null)).toBeNull();
  });
});
