// A12 (UNI-924): collect pass over the engine's own revision data. The
// fixtures build the editor document through the vendored converter
// (blocksToPmDoc) from the same block/run revision fields the parser fills, so
// the test proves the model reads the engine's marks and attrs, not a fixture
// invented beside them.
import { Editor } from "@tiptap/core";
import { blocksToPmDoc, type RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { collectReviewChanges, findReviewChange } from "./revision-model";

const DATE = "2026-01-02T03:04:05Z";

const BLOCKS: RendererBlock[] = [
  {
    type: "paragraph",
    docxIndex: 0,
    runs: [
      { text: "base " },
      { text: "ALPHA", ins: { author: "Alice", date: DATE } },
      { text: "INS", ins: { author: "Alice", date: DATE } },
      { text: " BETA", del: { author: "Bob", date: DATE } },
      { text: " GAMMA", ins: { author: "Alice", date: DATE }, del: { author: "Bob", date: DATE } },
    ],
  },
  {
    type: "paragraph",
    docxIndex: 1,
    runs: [{ text: "styled", rPrChange: { author: "Carol", date: DATE, old: { bold: true } } }],
  },
  { type: "paragraph", docxIndex: 2, runs: [{ text: "moved" }], moveRevision: "from" },
  {
    type: "paragraph",
    docxIndex: 3,
    format: { align: "right" },
    runs: [{ text: "aligned" }],
    pPrChangeInfo: { author: "Dave", date: DATE, old: { type: "docParagraph", format: { align: "center" } } },
  },
  {
    type: "paragraph",
    docxIndex: 4,
    runs: [{ text: "second block" }],
    blockRevision: { kind: "ins", author: "Alice", date: DATE },
  },
  {
    type: "table",
    docxIndex: 5,
    table: {
      rows: [[{ paras: ["r1"] }], [{ paras: ["r2"] }]],
      rowRevisions: [null, { kind: "del", author: "Bob", date: DATE }],
    },
  },
];

let editor: Editor | null = null;

function createEditor(blocks: RendererBlock[] = BLOCKS): Editor {
  editor = new Editor({ extensions: docxExtensions(), content: blocksToPmDoc(blocks) });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("collectReviewChanges", () => {
  it("finds nothing in a clean document", () => {
    const clean = createEditor([{ type: "paragraph", docxIndex: 0, runs: [{ text: "plain" }] }]);
    expect(collectReviewChanges(clean.state.doc)).toEqual([]);
  });

  it("lists every revision kind in document order with author and date", () => {
    const changes = collectReviewChanges(createEditor().state.doc);
    expect(changes.map((change) => change.kind)).toEqual([
      "ins",
      "del",
      "both",
      "rPrChange",
      "moveFrom",
      "pPrChange",
      "blockIns",
      "rowDel",
    ]);
    expect(changes.map((change) => change.author)).toEqual([
      "Alice",
      "Bob",
      "Bob",
      "Carol",
      "",
      "Dave",
      "Alice",
      "Bob",
    ]);
    expect(changes[0]?.date).toBe(DATE);
    expect(changes.every((change) => change.from < change.to)).toBe(true);
  });

  it("merges adjacent same-author runs and reads their snippet", () => {
    const changes = collectReviewChanges(createEditor().state.doc);
    const ins = changes.find((change) => change.kind === "ins");
    expect(ins?.snippet).toBe("ALPHAINS");
    expect(ins?.author).toBe("Alice");
    // the insertion, deletion and both-runs stay separate entries
    expect(changes.find((change) => change.kind === "del")?.snippet).toBe("BETA");
    expect(changes.find((change) => change.kind === "both")?.snippet).toBe("GAMMA");
  });

  it("reads paragraph and block levels through the block's own text", () => {
    const changes = collectReviewChanges(createEditor().state.doc);
    expect(changes.find((change) => change.kind === "rPrChange")?.snippet).toBe("styled");
    expect(changes.find((change) => change.kind === "moveFrom")?.snippet).toBe("moved");
    expect(changes.find((change) => change.kind === "pPrChange")?.snippet).toBe("aligned");
    expect(changes.find((change) => change.kind === "blockIns")?.snippet).toBe("second block");
    expect(changes.find((change) => change.kind === "rowDel")?.snippet).toBe("r2");
  });

  it("publishes stable ids and resolves them back", () => {
    const changes = collectReviewChanges(createEditor().state.doc);
    const first = changes[0]!;
    expect(first.id).toBe(`${first.kind}:${first.from}:${first.to}`);
    expect(findReviewChange(changes, first.id)).toEqual(first);
    expect(findReviewChange(changes, "missing")).toBeNull();
  });
});
