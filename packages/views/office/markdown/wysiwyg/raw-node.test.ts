// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor, generateHTML, generateJSON } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createMarkdownEditorExtensions } from "./extensions";
import { createMarkdownSourceCodec, createMarkdownSourceManager, toEditorDocument } from "./serialize";
import { MARKDOWN_RAW_NODE_NAME, rawNodeSource } from "./raw-node";

const source = () => createMarkdownSourceCodec(createMarkdownEditorExtensions());

/** Content the WYSIWYG cannot represent, each with the exact bytes to preserve. */
const UNREPRESENTABLE: Array<{ name: string; text: string }> = [
  { name: "HTML comment", text: "<!-- keep this comment -->\n" },
  { name: "raw HTML block", text: '<div class="note">\n  <p>raw html block</p>\n</div>\n' },
  { name: "self-closing HTML", text: "<figure>\n  <img src=\"a.png\">\n</figure>\n" },
  { name: "unknown element", text: "<my-widget data-x=\"1\">\n  body\n</my-widget>\n" },
  { name: "footnote definition", text: "[^1]: The footnote body stays literal.\n" },
  { name: "footnote reference", text: "Footnote reference[^1] here.\n" },
  { name: "frontmatter only", text: "---\ntitle: Only\n---\n" },
  { name: "GFM table needing re-pad", text: "| a | b |\n| - | - |\n| 1 | 2 |\n" },
];

describe("markdownRaw opaque node", () => {
  it("preserves each unrepresentable construct byte-identical", () => {
    const codec = source();
    for (const { name, text } of UNREPRESENTABLE) {
      const doc = codec.parse(text);
      expect(`${name}: ${codec.serialize(doc)}`).toBe(`${name}: ${text}`);
    }
  });

  it("keeps the raw node's `source` attribute exactly, never normalised", () => {
    const manager = createMarkdownSourceManager(createMarkdownEditorExtensions());
    const text = '<div class="a">\n\t<p>tab indented</p>\n</div>\n';
    const doc = toEditorDocument(text, manager);
    const raw = (doc.content ?? []).find((node) => node.type === MARKDOWN_RAW_NODE_NAME);
    expect(raw).toBeDefined();
    // The attribute is the untouched block slice: the tab is preserved (the
    // block's trailing newline is the document tail, not part of the block).
    expect(rawNodeSource(raw)).toBe('<div class="a">\n\t<p>tab indented</p>\n</div>');
    expect(source().serialize(doc)).toBe(text);
  });

  it("round-trips a mixed document with every construct in one string", () => {
    const codec = source();
    const mixed = [
      "---",
      "title: Mixed",
      "---",
      "",
      "<!-- comment one -->",
      "",
      "<div>",
      "  <p>html</p>",
      "</div>",
      "",
      "Footnote[^a] and a body.",
      "",
      "[^a]: body",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "# Heading",
      "",
      "Last line.",
      "",
    ].join("\n");
    expect(codec.serialize(codec.parse(mixed))).toBe(mixed);
  });

  it("never normalises whitespace inside a raw block", () => {
    const codec = source();
    const text = "<!--  spaced  comment  -->\n";
    const doc = codec.parse(text);
    const raw = (doc.content ?? [])[0] as { type?: string };
    expect(raw.type).toBe(MARKDOWN_RAW_NODE_NAME);
    expect(codec.serialize(doc)).toBe(text);
  });

  it("keeps its source through an HTML round-trip (getHTML -> setContent)", () => {
    // Regression: `parseHTML` read `data-source` but TipTap auto-rendered the
    // attribute as `source="…"`, so any HTML-flavour round-trip parsed
    // `source: ""` and the block serialized to NOTHING (silent content loss).
    const extensions = createMarkdownEditorExtensions();
    const codec = source();
    for (const text of ["<!-- keep -->\n", '<div class="note">\n  <p>x</p>\n</div>\n']) {
      const doc = codec.parse(text);
      const html = generateHTML(doc, extensions);
      // `data-source` is the parse attribute; a bare `source=` would be the bug.
      expect(html).toContain("data-source=");
      expect(html).not.toMatch(/\ssource="/);
      const reparsed = generateJSON(html, extensions) as JSONContent;
      const raw = (reparsed.content ?? []).find((node) => node.type === MARKDOWN_RAW_NODE_NAME);
      expect(raw).toBeDefined();
      // The block's own bytes survive — this is the assertion the regression
      // guard rests on (pre-fix `source` parsed as "" and this was "").
      expect(rawNodeSource(raw)).toBe(text.trimEnd());
      // HTML carries neither `mdLead` nor the appended caret paragraph's stored
      // empty separator (`toEditorDocument` adds one empty paragraph when the
      // document has no textblock, so `Selection.atStart` has a caret home).
      // The doc-level tail and that separator are therefore re-serialised with
      // the default blank line; the raw block's bytes are unchanged.
      expect(codec.serialize(reparsed)).toBe(text.trimEnd() + "\n\n");
    }
  });

  it("repairs a NodeSelection over the raw node even when the next block is a selectable atom", () => {
    // `Selection.near` accepts ANY valid selection, so on `[markdownRaw,
    // blockMath]` it returned a NodeSelection on the adjacent math atom and the
    // guard bailed, leaving the raw node selected (and the next keystroke able
    // to replace the front matter). The repair must search TEXTBLOCKS only.
    const extensions = createMarkdownEditorExtensions();
    const codec = createMarkdownSourceCodec(extensions);
    const text = "---\ntitle: X\n---\n\n$$\nx = 1\n$$\n";
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({ element, extensions, content: codec.parse(text), contentType: "json" });
    try {
      // The codec appends an empty paragraph because neither block is a
      // textblock, so there is a caret home to repair into.
      const types = editor.state.doc.children.map((child) => child.type.name);
      expect(types).toContain("markdownRaw");
      expect(types).toContain("blockMath");
      expect(types).toContain("paragraph");

      editor.commands.setNodeSelection(0);
      const selection = editor.state.selection;
      expect(selection).toBeInstanceOf(TextSelection);
      expect(selection.$from.parent.type.name).toBe("paragraph");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("keeps inline HTML the schema would drop as an opaque raw block", () => {
    const codec = source();
    // `<u>` has no Markdown representation and StarterKit disables the
    // underline mark, so the paragraph round-trip would lose the tag. The
    // conservative fallback is a raw node, which is what keeps the bytes.
    const text = "Text with <u>underline</u> inside.\n";
    const doc = codec.parse(text);
    const raw = (doc.content ?? []).find((node) => node.type === MARKDOWN_RAW_NODE_NAME);
    expect(raw).toBeDefined();
    expect(codec.serialize(doc)).toBe(text);
  });
});
