// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
