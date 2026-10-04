// A12 (UNI-924): the review command area over a real editor — list caching per
// document version, per-change and bulk wiring, jump, and the read-only guard
// (the apply pass itself is deliberately unguarded, the factory is the gate).
import { Editor } from "@tiptap/core";
import { blocksToPmDoc, type RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createReviewCommands } from "./review";

const DATE = "2026-01-02T03:04:05Z";

const BLOCKS: RendererBlock[] = [
  {
    type: "paragraph",
    docxIndex: 0,
    runs: [
      { text: "base " },
      { text: "ALPHA_INS", ins: { author: "Alice", date: DATE } },
      { text: " BETA_DEL", del: { author: "Bob", date: DATE } },
    ],
  },
];

let editor: Editor | null = null;

function createEditor(editable = true): Editor {
  editor = new Editor({ extensions: docxExtensions(), content: blocksToPmDoc(BLOCKS), editable });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("createReviewCommands", () => {
  it("is inert before a document opens", () => {
    const area = createReviewCommands({ getEditor: () => null });
    expect(area.readState(null)).toEqual({ reviewChanges: [] });
    expect(area.commands.listReviewChanges()).toEqual([]);
    expect(area.commands.acceptReviewChange("ins:1:6")).toBe(false);
    expect(area.commands.rejectReviewChange("ins:1:6")).toBe(false);
    expect(area.commands.acceptAllReviewChanges()).toBe(false);
    expect(area.commands.rejectAllReviewChanges()).toBe(false);
    expect(area.commands.jumpToReviewChange("ins:1:6")).toBe(false);
  });

  it("lists the document's changes and caches them per document version", () => {
    const current = createEditor();
    const area = createReviewCommands({ getEditor: () => current });
    const state = area.readState(current).reviewChanges;
    expect(state.map((change) => change.kind)).toEqual(["ins", "del"]);
    const first = area.commands.listReviewChanges();
    expect(area.commands.listReviewChanges()).toBe(first);
    expect(first).toEqual(state);
  });

  it("accepts and rejects one change by id and refuses an unknown id", () => {
    const current = createEditor();
    const area = createReviewCommands({ getEditor: () => current });
    const ins = area.commands.listReviewChanges().find((change) => change.kind === "ins")!;
    expect(area.commands.acceptReviewChange("missing")).toBe(false);
    expect(area.commands.acceptReviewChange(ins.id)).toBe(true);
    expect(current.state.doc.textContent).toContain("ALPHA_INS");
    const del = area.commands.listReviewChanges().find((change) => change.kind === "del")!;
    expect(area.commands.rejectReviewChange(del.id)).toBe(true);
    expect(area.commands.listReviewChanges()).toEqual([]);
    expect(current.state.doc.textContent).toContain("BETA_DEL");
  });

  it("accepts or rejects every change, then reports an empty list", () => {
    const accept = createEditor();
    const area = createReviewCommands({ getEditor: () => accept });
    expect(area.commands.acceptAllReviewChanges()).toBe(true);
    expect(area.commands.listReviewChanges()).toEqual([]);
    expect(area.commands.acceptAllReviewChanges()).toBe(false);

    const reject = createEditor();
    const rejectArea = createReviewCommands({ getEditor: () => reject });
    expect(rejectArea.commands.rejectAllReviewChanges()).toBe(true);
    expect(rejectArea.commands.listReviewChanges()).toEqual([]);
    expect(rejectArea.commands.rejectAllReviewChanges()).toBe(false);
  });

  it("jumps to a change and refuses an unknown id", () => {
    const current = createEditor();
    const area = createReviewCommands({ getEditor: () => current });
    const ins = area.commands.listReviewChanges().find((change) => change.kind === "ins")!;
    expect(area.commands.jumpToReviewChange(ins.id)).toBe(true);
    expect(current.state.selection.from).toBe(ins.from);
    expect(area.commands.jumpToReviewChange("missing")).toBe(false);
  });

  it("shows changes but refuses every mutation on a read-only document", () => {
    const current = createEditor(false);
    const area = createReviewCommands({ getEditor: () => current });
    const changes = area.commands.listReviewChanges();
    expect(changes).toHaveLength(2);
    expect(area.commands.acceptReviewChange(changes[0]!.id)).toBe(false);
    expect(area.commands.rejectReviewChange(changes[0]!.id)).toBe(false);
    expect(area.commands.acceptAllReviewChanges()).toBe(false);
    expect(area.commands.rejectAllReviewChanges()).toBe(false);
    expect(current.state.doc.textContent).toContain("ALPHA_INS");
    expect(area.commands.listReviewChanges()).toHaveLength(2);
  });
});
