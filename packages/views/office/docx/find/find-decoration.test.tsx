import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDocxFindHighlight,
  buildFindDecorations,
  clearDocxFindHighlight,
  docxFindPluginKey,
  mountDocxFindHighlight,
} from "./find-decoration";
import { DEFAULT_FIND_OPTIONS, findMatches } from "./find-state";

const editors: Editor[] = [];

function editorWith(lines: string[]): Editor {
  const content: JSONContent = {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("find decorations", () => {
  it("paints every hit and marks the active one", () => {
    const editor = editorWith(["alpha beta alpha"]);
    const unmount = mountDocxFindHighlight(editor);
    const matches = findMatches(editor, "alpha", DEFAULT_FIND_OPTIONS);
    expect(matches).toHaveLength(2);

    applyDocxFindHighlight(editor, matches, 1);
    expect(docxFindPluginKey.getState(editor.state)?.find().map((decoration) => [decoration.from, decoration.to])).toEqual([
      [1, 6],
      [11, 16],
    ]);
    const hits = Array.from(editor.view.dom.querySelectorAll(".search-hit"));
    expect(hits.map((hit) => hit.getAttribute("data-docx-find"))).toEqual(["match", "active"]);
    expect(hits.map((hit) => hit.classList.contains("search-hit-active"))).toEqual([false, true]);

    unmount();
    expect(docxFindPluginKey.getState(editor.state)).toBeUndefined();
  });

  it("maps existing hits through a document change and clears on demand", () => {
    const editor = editorWith(["alpha beta alpha"]);
    const unmount = mountDocxFindHighlight(editor);
    applyDocxFindHighlight(editor, findMatches(editor, "alpha", DEFAULT_FIND_OPTIONS), 0);

    editor.commands.insertContentAt(1, "zz ");
    const decorations = docxFindPluginKey.getState(editor.state)?.find() ?? [];
    expect(decorations.map((decoration) => [decoration.from, decoration.to])).toEqual([
      [4, 9],
      [14, 19],
    ]);

    clearDocxFindHighlight(editor);
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(0);
    unmount();
  });

  it("builds an empty set when nothing matched", () => {
    const editor = editorWith(["alpha"]);
    expect(buildFindDecorations(editor.state.doc, [], 0).find()).toEqual([]);
  });
});
