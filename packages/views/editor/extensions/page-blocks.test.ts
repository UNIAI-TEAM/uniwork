import { afterEach, describe, expect, it } from "vitest";
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { initI18n } from "@uniwork/core/i18n";
import { sanitizePageContent } from "@uniwork/core/documents/schema";
import { createPageDocumentExtensions } from ".";
import { filterPageBlocks, insertPageBlock, PAGE_BLOCKS } from "./page-blocks";

const { t } = initI18n();
let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe("page block menu", () => {
  it("matches Vietnamese without accents and English in either locale", () => {
    expect(filterPageBlocks("tieu de", t).map((item) => item.id)).toEqual(["heading1", "heading2", "heading3"]);
    expect(filterPageBlocks("numbered", t).map((item) => item.id)).toContain("orderedList");
    expect(filterPageBlocks("trích dẫn", t).map((item) => item.id)).toContain("blockquote");
    expect(filterPageBlocks("not-a-block", t)).toEqual([]);
  });

  it.each(PAGE_BLOCKS.filter((item) => item.id !== "image" && item.id !== "mention"))(
    "inserts $id within the page vocabulary and removes the typed slash", (item) => {
      editor = new Editor({ extensions: createPageDocumentExtensions({ image: Image,
        assetUpload: Extension.create({ name: "testUpload" }) }), content: "<p>/</p>" });
      editor.commands.setTextSelection(2);
      insertPageBlock(editor, { from: 1, to: 2 }, item.id);
      const json: JSONContent = editor.getJSON();
      expect(editor.getText()).not.toContain("/");
      editor.commands.setContent(sanitizePageContent(json).content as JSONContent, { emitUpdate: false });
      expect(editor.getJSON()).toEqual(json);
      expect(json.content?.[0]?.type).toBe(item.nodeType);
      if (item.id.startsWith("heading")) expect(json.content?.[0]?.attrs?.level).toBe(Number(item.id.at(-1)));
      if (item.id === "table") {
        expect(json.content?.[0]?.content).toHaveLength(3);
        expect(json.content?.[0]?.content?.every((row) => row.content?.length === 3)).toBe(true);
      }
    },
  );

  it("starts a mention with @ while keeping unknown command nodes out of persisted content", () => {
    editor = new Editor({ extensions: createPageDocumentExtensions({ image: Image,
      assetUpload: Extension.create({ name: "testUpload" }) }), content: "<p>/</p>" });
    insertPageBlock(editor, { from: 1, to: 2 }, "mention");
    expect(editor.getText()).toBe("@");
    expect(sanitizePageContent({ type: "doc", content: [{ type: "slashCommand", attrs: { id: "skill" } }] }).content).toEqual({ type: "doc", content: [] });
  });

  it("decorates only the selected empty paragraph and suppresses placeholders in read-only mode", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: createPageDocumentExtensions({ image: Image,
      assetUpload: Extension.create({ name: "testUpload" }), placeholder: "Insert a block" }),
      content: "<p></p><p>Content</p><p></p>" });
    expect(element.querySelectorAll("[data-placeholder]")).toHaveLength(1);
    expect(element.querySelector("p")?.getAttribute("data-placeholder")).toBe("Insert a block");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(element.querySelectorAll("[data-placeholder]")).toHaveLength(1);
    expect(element.querySelector("p:last-child")?.getAttribute("data-placeholder")).toBe("Insert a block");
    editor.commands.setContent("<ul><li><p></p></li></ul>");
    editor.commands.setTextSelection(3);
    expect(element.querySelectorAll("[data-placeholder]")).toHaveLength(1);
    expect(element.querySelector("li p")?.getAttribute("data-placeholder")).toBe("Insert a block");
    editor.setEditable(false);
    expect(element.querySelectorAll("[data-placeholder]")).toHaveLength(0);
    element.remove();
  });
});
