import type { JSONContent } from "@tiptap/core";
import type { RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import { describe, expect, it } from "vitest";
import { editorJsonTexts, rendererBlockText, rendererBlockTexts } from "./sources";

function block(overrides: Partial<RendererBlock>): RendererBlock {
  return { type: "paragraph", docxIndex: 0, ...overrides };
}

describe("rendererBlockTexts", () => {
  it("joins a block's runs and falls back to its preview text", () => {
    expect(rendererBlockText(block({ runs: [{ text: "Hello " }, { text: "world" }] }))).toBe("Hello world");
    expect(rendererBlockText(block({ type: "table", previewText: "Cell text" }))).toBe("Cell text");
    expect(rendererBlockText(block({ type: "image" }))).toBe("");
  });

  it("keeps document order and drops only hidden blocks", () => {
    const blocks = [
      block({ docxIndex: 0, runs: [{ text: "first" }] }),
      block({ docxIndex: 1, hidden: true, runs: [{ text: "trailing sectPr text" }] }),
      block({ docxIndex: 2, runs: [{ text: "second" }] }),
    ];
    expect(rendererBlockTexts(blocks)).toEqual(["first", "second"]);
  });
});

describe("editorJsonTexts", () => {
  it("reads plain text from paragraph, heading and list-item nodes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "docHeading", content: [{ type: "text", text: "Title" }] },
        { type: "docParagraph", content: [{ type: "text", text: "Body " }, { type: "text", text: "text" }] },
        { type: "docListItem", content: [{ type: "text", text: "Item" }] },
      ],
    };
    expect(editorJsonTexts(doc)).toEqual(["Title", "Body text", "Item"]);
  });

  it("reads protected blocks through their preview text, like the parse does", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "docProtected", attrs: { previewText: "Table 2×2", blockType: "table" } },
        { type: "docProtected", attrs: { blockType: "image" } },
      ],
    };
    expect(editorJsonTexts(doc)).toEqual(["Table 2×2", ""]);
  });

  it("flattens nested table content into one row", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "docTable",
          content: [
            {
              type: "docTableRow",
              content: [{ type: "docTableCell", content: [{ type: "docParagraph", content: [{ type: "text", text: "cell one" }] }] }],
            },
            {
              type: "docTableRow",
              content: [{ type: "docTableCell", content: [{ type: "docParagraph", content: [{ type: "text", text: "cell two" }] }] }],
            },
          ],
        },
      ],
    };
    expect(editorJsonTexts(doc)).toEqual(["cell onecell two"]);
  });

  it("returns one row per top-level node and none for an empty document", () => {
    expect(editorJsonTexts({ type: "doc", content: [] })).toEqual([]);
    expect(editorJsonTexts({ type: "doc" })).toEqual([]);
  });
});
