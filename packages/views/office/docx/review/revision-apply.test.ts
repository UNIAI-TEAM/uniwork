// A12 (UNI-924): accept/reject semantics against a real TipTap editor. The
// expectations mirror the vendored apply pass: an accepted insertion keeps its
// text and loses the mark, a rejected deletion keeps its struck text, a
// rejected insertion removes the text, and the marker is stripped from the raw
// trPr/tcPr bytes a save regenerates from.
import { Editor } from "@tiptap/core";
import { blocksToPmDoc, type RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { applyReviewChanges, jumpToReviewChange } from "./revision-apply";
import { collectReviewChanges, type DocxReviewChange, type DocxReviewChangeKind } from "./revision-model";

const DATE = "2026-01-02T03:04:05Z";

const TEXT_BLOCKS: RendererBlock[] = [
  {
    type: "paragraph",
    docxIndex: 0,
    runs: [
      { text: "base " },
      { text: "ALPHA_INS", ins: { author: "Alice", date: DATE } },
      { text: " BETA_DEL", del: { author: "Bob", date: DATE } },
      { text: " GAMMA_BOTH", ins: { author: "Alice", date: DATE }, del: { author: "Bob", date: DATE } },
    ],
  },
  { type: "paragraph", docxIndex: 1, runs: [{ text: " tail" }] },
];

const BLOCK_INS: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "one" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "two" }], blockRevision: { kind: "ins", author: "Alice", date: DATE } },
];

const BLOCK_DEL: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "one" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "two" }], blockRevision: { kind: "del", author: "Bob", date: DATE } },
];

const RPR_CHANGE: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "styled", rPrChange: { author: "Carol", date: DATE, old: { bold: true } } }] },
];

const PPR_CHANGE: RendererBlock[] = [
  {
    type: "paragraph",
    docxIndex: 0,
    format: { align: "right" },
    runs: [{ text: "aligned" }],
    pPrChangeInfo: { author: "Dave", date: DATE, old: { type: "docParagraph", format: { align: "center" } } },
  },
];

const MOVE_FROM: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "one" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "moved" }], moveRevision: "from" },
];

const ROW_DEL: RendererBlock[] = [
  {
    type: "table",
    docxIndex: 0,
    table: {
      rows: [[{ paras: ["r1"] }], [{ paras: ["r2"] }]],
      rowRevisions: [null, { kind: "del", author: "Bob", date: DATE }],
    },
  },
];

// Every editor a test creates, so afterEach destroys them all: a leaked view keeps a
// DOMObserver flush timer that fires after jsdom teardown ("document is not defined").
const editors: Editor[] = [];

function createEditor(blocks: RendererBlock[], editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: blocksToPmDoc(blocks), editable });
  editors.push(editor);
  return editor;
}

function kinds(current: Editor): DocxReviewChangeKind[] {
  return collectReviewChanges(current.state.doc).map((change) => change.kind);
}

function changeOf(current: Editor, kind: DocxReviewChangeKind): DocxReviewChange {
  const change = collectReviewChanges(current.state.doc).find((candidate) => candidate.kind === kind);
  if (!change) throw new Error(`fixture has no ${kind} change`);
  return change;
}

function textMarks(current: Editor): string[] {
  const marks = new Set<string>();
  current.state.doc.descendants((node) => {
    if (node.isText) for (const mark of node.marks) marks.add(mark.type.name);
    return true;
  });
  return [...marks];
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("applyReviewChanges", () => {
  it("does nothing for an empty change list", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, [], "accept")).toBe(false);
  });

  it("accepts an insertion: text stays, marker goes", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, [changeOf(current, "ins")], "accept")).toBe(true);
    expect(current.state.doc.textContent).toContain("ALPHA_INS");
    expect(kinds(current)).toEqual(["del", "both"]);
  });

  it("rejects an insertion: text is removed", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, [changeOf(current, "ins")], "reject")).toBe(true);
    expect(current.state.doc.textContent).not.toContain("ALPHA_INS");
    expect(kinds(current)).toEqual(["del", "both"]);
  });

  it("accepts a deletion: struck text is removed", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, [changeOf(current, "del")], "accept")).toBe(true);
    expect(current.state.doc.textContent).not.toContain("BETA_DEL");
    expect(kinds(current)).toEqual(["ins", "both"]);
  });

  it("rejects a deletion: struck text becomes normal content", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, [changeOf(current, "del")], "reject")).toBe(true);
    expect(current.state.doc.textContent).toContain("BETA_DEL");
    expect(kinds(current)).toEqual(["ins", "both"]);
  });

  it("removes an inserted-then-deleted run either way", () => {
    const accept = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(accept, [changeOf(accept, "both")], "accept")).toBe(true);
    expect(accept.state.doc.textContent).not.toContain("GAMMA_BOTH");
    const reject = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(reject, [changeOf(reject, "both")], "reject")).toBe(true);
    expect(reject.state.doc.textContent).not.toContain("GAMMA_BOTH");
  });

  it("accept-all keeps insertions and drops deletions", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, collectReviewChanges(current.state.doc), "accept")).toBe(true);
    expect(kinds(current)).toEqual([]);
    expect(current.state.doc.textContent).toContain("ALPHA_INS");
    expect(current.state.doc.textContent).not.toContain("BETA_DEL");
    expect(current.state.doc.textContent).not.toContain("GAMMA_BOTH");
  });

  it("reject-all drops insertions and keeps deletions", () => {
    const current = createEditor(TEXT_BLOCKS);
    expect(applyReviewChanges(current, collectReviewChanges(current.state.doc), "reject")).toBe(true);
    expect(kinds(current)).toEqual([]);
    expect(current.state.doc.textContent).not.toContain("ALPHA_INS");
    expect(current.state.doc.textContent).toContain("BETA_DEL");
    expect(current.state.doc.textContent).not.toContain("GAMMA_BOTH");
  });

  it("accepts an inserted block in place and deletes a rejected one", () => {
    const accept = createEditor(BLOCK_INS);
    expect(applyReviewChanges(accept, [changeOf(accept, "blockIns")], "accept")).toBe(true);
    expect(accept.state.doc.childCount).toBe(2);
    expect(accept.state.doc.child(1).attrs.blockRevision).toBeNull();
    const reject = createEditor(BLOCK_INS);
    expect(applyReviewChanges(reject, [changeOf(reject, "blockIns")], "reject")).toBe(true);
    expect(reject.state.doc.childCount).toBe(1);
  });

  it("deletes an accepted deleted block and keeps a rejected one", () => {
    const accept = createEditor(BLOCK_DEL);
    expect(applyReviewChanges(accept, [changeOf(accept, "blockDel")], "accept")).toBe(true);
    expect(accept.state.doc.childCount).toBe(1);
    const reject = createEditor(BLOCK_DEL);
    expect(applyReviewChanges(reject, [changeOf(reject, "blockDel")], "reject")).toBe(true);
    expect(reject.state.doc.childCount).toBe(2);
    expect(reject.state.doc.child(1).attrs.blockRevision).toBeNull();
  });

  it("accepts a format revision by keeping the new format", () => {
    const current = createEditor(RPR_CHANGE);
    expect(applyReviewChanges(current, [changeOf(current, "rPrChange")], "accept")).toBe(true);
    expect(kinds(current)).toEqual([]);
    expect(textMarks(current)).not.toContain("rprChange");
    expect(textMarks(current)).not.toContain("bold");
  });

  it("rejects a format revision by restoring the recorded format", () => {
    const current = createEditor(RPR_CHANGE);
    expect(applyReviewChanges(current, [changeOf(current, "rPrChange")], "reject")).toBe(true);
    expect(kinds(current)).toEqual([]);
    expect(textMarks(current)).toContain("bold");
    expect(textMarks(current)).not.toContain("rprChange");
  });

  it("accepts a paragraph format change by keeping it", () => {
    const current = createEditor(PPR_CHANGE);
    expect(applyReviewChanges(current, [changeOf(current, "pPrChange")], "accept")).toBe(true);
    expect(current.state.doc.firstChild?.attrs.pPrChange).toBeNull();
    expect(current.state.doc.firstChild?.attrs.align).toBe("right");
  });

  it("rejects a paragraph format change by restoring the snapshot", () => {
    const current = createEditor(PPR_CHANGE);
    expect(applyReviewChanges(current, [changeOf(current, "pPrChange")], "reject")).toBe(true);
    expect(current.state.doc.firstChild?.attrs.pPrChange).toBeNull();
    expect(current.state.doc.firstChild?.attrs.align).toBe("center");
  });

  it("accepts a moved-from paragraph by removing it, keeps it on reject", () => {
    const accept = createEditor(MOVE_FROM);
    expect(applyReviewChanges(accept, [changeOf(accept, "moveFrom")], "accept")).toBe(true);
    expect(accept.state.doc.childCount).toBe(1);
    const reject = createEditor(MOVE_FROM);
    expect(applyReviewChanges(reject, [changeOf(reject, "moveFrom")], "reject")).toBe(true);
    expect(reject.state.doc.childCount).toBe(2);
    expect(reject.state.doc.child(1).attrs.moveRevision).toBeNull();
  });

  it("deletes an accepted deleted row and keeps a rejected one", () => {
    const accept = createEditor(ROW_DEL);
    expect(applyReviewChanges(accept, [changeOf(accept, "rowDel")], "accept")).toBe(true);
    expect(accept.state.doc.firstChild?.childCount).toBe(1);
    const reject = createEditor(ROW_DEL);
    expect(applyReviewChanges(reject, [changeOf(reject, "rowDel")], "reject")).toBe(true);
    expect(reject.state.doc.firstChild?.childCount).toBe(2);
    expect(reject.state.doc.firstChild?.child(1).attrs.rowRevision).toBeNull();
  });
});

describe("jumpToReviewChange", () => {
  it("selects the change range", () => {
    const current = createEditor(TEXT_BLOCKS);
    const change = changeOf(current, "ins");
    expect(jumpToReviewChange(current, change)).toBe(true);
    expect(current.state.selection.from).toBe(change.from);
    expect(current.state.selection.to).toBe(change.to);
  });
});
