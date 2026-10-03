// Controller tests over a real TipTap editor built from the vendored DOCX
// extensions: anchors must land as the parser's own shapes (run marks for a
// single block, commentStarts/commentEnds across blocks) so a save round-trips.
import { Editor } from "@tiptap/core";
import { blocksToPmDoc, type RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createDocxCommentsController } from "./docx-comments-controller";

const BLOCKS: RendererBlock[] = [
  { type: "paragraph", docxIndex: 0, runs: [{ text: "hello world" }] },
  { type: "paragraph", docxIndex: 1, runs: [{ text: "second block" }] },
];

function createEditor(): Editor {
  return new Editor({ extensions: docxExtensions(), content: blocksToPmDoc(BLOCKS) });
}

/** Every comment id anchored in the document (marks + block attrs). */
function anchoredIds(editor: Editor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      for (const mark of node.marks) {
        if (mark.type.name !== "comment") continue;
        for (const id of String(mark.attrs.ids ?? "").split(" ")) if (id) ids.add(id);
      }
      return;
    }
    for (const attr of ["commentStarts", "commentEnds"]) {
      const value = node.attrs[attr];
      if (Array.isArray(value)) for (const id of value) ids.add(String(id));
    }
  });
  return [...ids].sort();
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("docx comments controller", () => {
  it("seeds and lists copies, never the caller's array", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    const seeded = [{ id: "1", author: "Alice", text: "seeded" }];
    controller.seed(seeded);
    seeded[0]!.text = "mutated";
    expect(controller.list()).toEqual([{ id: "1", author: "Alice", text: "seeded" }]);
  });

  it("adds a comment on a selection, marking the covered text", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const comment = controller.add("please review", "Tester", "T");
    expect(comment).toMatchObject({ id: "1", author: "Tester", text: "please review", initials: "T" });
    expect(comment?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(anchoredIds(editor)).toEqual(["1"]);
    expect(controller.hasAnchor("1")).toBe(true);
    expect(controller.list()).toHaveLength(1);
  });

  it("refuses to add without a selection or without text", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    editor.commands.setTextSelection(3);
    expect(controller.add("no selection", "Tester")).toBeNull();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(controller.add("   ", "Tester")).toBeNull();
    expect(controller.list()).toEqual([]);
  });

  it("anchors a cross-paragraph range on the boundary blocks", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    const second = editor.state.doc.child(1);
    const secondStart = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.setTextSelection({ from: 3, to: Math.min(secondStart + 3, secondStart + second.content.size) });
    const comment = controller.add("spans blocks", "Tester");
    expect(comment).not.toBeNull();
    const id = comment!.id;
    expect(editor.state.doc.child(0).attrs.commentStarts).toEqual([id]);
    expect(editor.state.doc.child(1).attrs.commentEnds).toEqual([id]);
    expect(anchoredIds(editor)).toEqual([id]);
  });

  it("shares the parent anchor on reply and refuses an unknown parent", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    controller.add("parent", "Tester");
    expect(controller.reply("404", "nope", "Tester")).toBeNull();
    const reply = controller.reply("1", "agreed", "Tester");
    expect(reply).toMatchObject({ id: "2", parentId: "1" });
    expect(anchoredIds(editor)).toEqual(["1", "2"]);
  });

  it("resolves and reopens a thread, refusing unknown ids", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    controller.seed([
      { id: "1", author: "A", text: "root" },
      { id: "2", author: "B", text: "reply", parentId: "1" },
    ]);
    expect(controller.resolve("404", true)).toBe(false);
    expect(controller.resolve("1", true)).toBe(true);
    expect(controller.list().map((c) => c.done)).toEqual([true, true]);
    controller.resolve("1", false);
    expect(controller.list().map((c) => c.done)).toEqual([false, false]);
  });

  it("deletes a thread with its replies and strips their anchors", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    controller.add("parent", "Tester");
    controller.reply("1", "reply", "Tester");
    expect(controller.remove("1")).toBe(true);
    expect(controller.list()).toEqual([]);
    expect(anchoredIds(editor)).toEqual([]);
    expect(controller.hasAnchor("1")).toBe(false);
    expect(controller.remove("404")).toBe(false);
  });

  it("reads the rendered anchor text and jumps to it", () => {
    editor = createEditor();
    const controller = createDocxCommentsController(() => editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    controller.add("parent", "Tester");
    expect(controller.anchorTexts().get("1")).toBe("hello");
    expect(controller.jump("1")).toBe(true);
    expect(controller.jump("404")).toBe(false);
  });
});
