import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { DocxBlock } from "@uniwork/office-engine/docx";
import { blocksToDoc, computeDesiredList, kindOf, listsEqual, runsEqual } from "./docx-doc-convert";
import { docxExtensions } from "./docx-schema";

const kitchenSink: DocxBlock[] = [
  { type: "heading", docxIndex: 0, runs: [{ text: "Spec" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "alpha" }] },
  { type: "table", docxIndex: 2, runs: [] },
  { type: "paragraph", docxIndex: 3, runs: [{ text: "omega" }] },
  { type: "paragraph", docxIndex: 4, runs: [{ text: "hidden" }], hidden: true },
];

function editorFrom(blocks: DocxBlock[]) {
  return new Editor({ extensions: docxExtensions(), content: blocksToDoc(blocks) });
}

describe("runsEqual / listsEqual", () => {
  it("compares text and formatting flags, not just text", () => {
    expect(runsEqual([{ text: "a", bold: true }], [{ text: "a", bold: true }])).toBe(true);
    expect(runsEqual([{ text: "a", bold: true }], [{ text: "a" }])).toBe(false);
    expect(runsEqual([{ text: "a" }], [{ text: "a" }, { text: "b" }])).toBe(false);
  });
  it("list equality is null-safe", () => {
    expect(listsEqual(null, null)).toBe(true);
    expect(listsEqual(null, { kind: "bullet", numId: "1", ilvl: 0 })).toBe(false);
    expect(listsEqual({ kind: "bullet", numId: "1", ilvl: 0 }, { kind: "bullet", numId: "1", ilvl: 0 })).toBe(true);
  });
});

describe("kindOf", () => {
  it("maps engine block.type to a visual blockKind", () => {
    expect(kindOf({ type: "heading", docxIndex: 0, level: 2 })).toEqual({ blockKind: "heading", level: 2, list: null });
    expect(kindOf({ type: "paragraph", docxIndex: 0 })).toEqual({ blockKind: "paragraph", level: null, list: null });
    expect(kindOf({ type: "table", docxIndex: 0 })).toEqual({ blockKind: "other", level: null, list: null });
    expect(kindOf({ type: "listItem", docxIndex: 0, list: { kind: "ordered", numId: "n1", ilvl: 1 } }))
      .toEqual({ blockKind: "listItem", level: null, list: { kind: "ordered", numId: "n1", ilvl: 1 } });
  });
});

describe("blocksToDoc", () => {
  it("keeps only visible blocks, in order, and never touches hidden ones", () => {
    const doc = blocksToDoc(kitchenSink);
    const content = doc.content as Array<{ attrs: { docxIndex: number | null; blockKind: string } }>;
    expect(content.map((n) => n.attrs.docxIndex)).toEqual([0, 1, 2, 3]);
    expect(content.map((n) => n.attrs.blockKind)).toEqual(["heading", "paragraph", "other", "paragraph"]);
  });

  it("marks a non-paragraph/heading/listItem block 'other' and gives it a placeholder label", () => {
    const doc = blocksToDoc(kitchenSink);
    const content = doc.content as Array<{ attrs: { blockKind: string; placeholderLabel: string | null } }>;
    expect(content[2]).toMatchObject({ attrs: { blockKind: "other", placeholderLabel: "[table]" } });
  });
});

describe("computeDesiredList", () => {
  it("passes through an untouched document", () => {
    const editor = editorFrom(kitchenSink);
    const byIndex = new Map(kitchenSink.filter((b) => !b.hidden).map((b) => [b.docxIndex as number, b]));
    const desired = computeDesiredList(editor.state.doc, byIndex);
    expect(desired).toEqual([
      { kind: "passthrough", docxIndex: 0 },
      { kind: "passthrough", docxIndex: 1 },
      { kind: "passthrough", docxIndex: 2 },
      { kind: "passthrough", docxIndex: 3 },
    ]);
    editor.destroy();
  });

  it("emits a text-edit only for a touched plain paragraph", () => {
    const editor = editorFrom(kitchenSink);
    const byIndex = new Map(kitchenSink.filter((b) => !b.hidden).map((b) => [b.docxIndex as number, b]));
    // Find the docxIndex=1 node and retype its text.
    let targetPos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs.docxIndex === 1) targetPos = offset;
    });
    editor.commands.insertContentAt({ from: targetPos + 1, to: targetPos + 1 + "alpha".length }, "ALPHA-EDITED");
    const desired = computeDesiredList(editor.state.doc, byIndex);
    expect(desired).toContainEqual({ kind: "text-edit", docxIndex: 1, runs: [{ text: "ALPHA-EDITED" }] });
    expect(desired.find((item) => "docxIndex" in item && item.docxIndex === 0)).toEqual({ kind: "passthrough", docxIndex: 0 });
    editor.destroy();
  });

  it("never emits an op for an 'other' block even if something touched it", () => {
    const editor = editorFrom(kitchenSink);
    const byIndex = new Map(kitchenSink.filter((b) => !b.hidden).map((b) => [b.docxIndex as number, b]));
    const desired = computeDesiredList(editor.state.doc, byIndex);
    expect(desired).toContainEqual({ kind: "passthrough", docxIndex: 2 });
    editor.destroy();
  });

  it("restyles a heading into a plain paragraph as remove+insert, never a retype", () => {
    const editor = editorFrom(kitchenSink);
    const byIndex = new Map(kitchenSink.filter((b) => !b.hidden).map((b) => [b.docxIndex as number, b]));
    editor.commands.updateAttributes("docxBlock", { blockKind: "paragraph", level: null, list: null });
    // The caret starts at doc start (inside the heading, docxIndex 0).
    const desired = computeDesiredList(editor.state.doc, byIndex);
    expect(desired[0]).toEqual({ kind: "restyle", docxIndex: 0, block: { type: "paragraph", runs: [{ text: "Spec" }] } });
    editor.destroy();
  });

  it("drops an insert for a newly created block with no text", () => {
    const editor = editorFrom(kitchenSink);
    const byIndex = new Map(kitchenSink.filter((b) => !b.hidden).map((b) => [b.docxIndex as number, b]));
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.commands.splitBlock();
    const desired = computeDesiredList(editor.state.doc, byIndex);
    expect(desired.filter((item) => item.kind === "insert")).toEqual([]);
    editor.destroy();
  });
});
