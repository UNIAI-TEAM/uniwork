/**
 * The opaque raw node: the WYSIWYG fallback for anything it cannot represent.
 *
 * G3-08 requires that the saved source stays the raw text: frontmatter, GFM
 * tables, fenced code, raw HTML blocks, HTML comments, footnote syntax and any
 * construct the visual editor does not model must survive open -> serialize
 * byte-identical. `markdownRaw` is the node that carries such a run verbatim:
 *
 *   - `source` is the exact source slice, stored as a node attribute and
 *     emitted by `renderMarkdown` with no trimming, re-indentation, entity
 *     encoding or escaping. It is never normalised.
 *   - `atom` + `code` keep ProseMirror from parsing into it or re-serializing
 *     its contents; `isolating`/`defining` keep edits from merging across it.
 *   - The node is content-less: the text lives only in the attribute, so no
 *     Markdown round-trip can rewrite it.
 *
 * The bounded tokenizer below claims raw HTML blocks, HTML comments and the
 * frontmatter fence before any other extension sees them. It is bounded twice
 * (a size cap and anchored scans) so a pathological document cannot make it
 * walk the whole text per position.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";

export const MARKDOWN_RAW_NODE_NAME = "markdownRaw";

/**
 * Byte bound for the raw tokenizer. Anything past this is left to the built-in
 * Markdown lexer, which is linear; the tokenizer itself never scans more than
 * this many characters, so it cannot become the hot path on a huge document.
 */
export const RAW_TOKENIZER_LIMIT = 64 * 1024;

/** `---` on its own line through the closing `---`/`...` line. */
const FRONTMATTER = /^---[ \t]*\n[\s\S]*?(?:^|\n)(?:---|\.\.\.)[ \t]*(?:\n|$)/;
/** `<!-- … -->`, plus the trailing newline a block-level comment consumes. */
const HTML_COMMENT = /^<!--[\s\S]*?-->(?:[ \t]*\n|$)/;
/** An opening block tag, e.g. `<div class="x">` or `<figure>`. */
const OPEN_TAG = /^<([A-Za-z][\w-]*)(?:\s[^>]*)?>/;
/** The matching close tag, plus the trailing newline the lexer absorbs. */
function closingTag(name: string): RegExp {
  return new RegExp(`</${name}\\s*>(?:[ \\t]*\\n|$)`);
}

/**
 * True when `source` starts a construct this editor cannot represent, so the
 * caller must keep it opaque rather than let the Markdown lexer flatten it
 * (a raw HTML block otherwise collapses to its inner text and a comment
 * disappears entirely).
 */
function matchRawBlock(source: string): string | null {
  if (source.length > RAW_TOKENIZER_LIMIT) return null;
  const frontmatter = FRONTMATTER.exec(source);
  if (frontmatter) return frontmatter[0];
  if (!source.startsWith("<!--") && !OPEN_TAG.test(source)) return null;
  const comment = HTML_COMMENT.exec(source);
  if (comment) return comment[0];
  const open = OPEN_TAG.exec(source);
  if (!open) return null;
  const close = closingTag(open[1] as string).exec(source.slice(open[0].length));
  if (!close) return null;
  return source.slice(0, open[0].length + close.index + close[0].length);
}

/** The `source` a raw node carries, or "" when the node is not a raw node. */
export function rawNodeSource(node: JSONContent | null | undefined): string {
  if (!node || node.type !== MARKDOWN_RAW_NODE_NAME) return "";
  const source = node.attrs?.source;
  return typeof source === "string" ? source : "";
}

export const MarkdownRawExtension = Node.create({
  name: MARKDOWN_RAW_NODE_NAME,
  group: "block",
  atom: true,
  code: true,
  selectable: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      // `rendered: false` keeps the auto-rendered `source="…"` attribute out of
      // the DOM; `renderHTML` below emits `data-source` instead, matching
      // `parseHTML`. Without this the HTML round-trip read `source` as "" and
      // the block serialized to nothing.
      source: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-markdown-raw]",
        getAttrs: (element) => ({
          source: (element as HTMLElement).getAttribute("data-source") ?? "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const source = String(node.attrs.source ?? "");
    // Render the source inside the block so a construct the editor cannot
    // represent is still visible, and visibly not editable. M2/M6 can replace
    // this with a React node view; the attribute stays the source of truth.
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-markdown-raw": "", "data-source": source }),
      ["pre", { class: "markdown-raw-source" }, ["code", {}, source]],
    ];
  },

  markdownTokenizer: {
    name: MARKDOWN_RAW_NODE_NAME,
    level: "block" as const,
    start(source: string) {
      if (source.length > RAW_TOKENIZER_LIMIT) return -1;
      if (/^---[ \t]*\n/.test(source)) return 0;
      return source.search(/^(?:<!--|<[A-Za-z][\w-]*(?:\s[^>]*)?>)/m);
    },
    tokenize(source: string): MarkdownToken | undefined {
      const raw = matchRawBlock(source);
      if (!raw) return undefined;
      return { type: MARKDOWN_RAW_NODE_NAME, raw, tokens: [] };
    },
  },

  parseMarkdown: (token: { raw?: string }, helpers) =>
    helpers.createNode(MARKDOWN_RAW_NODE_NAME, { source: token.raw ?? "" }),

  // Byte-identical by construction: the attribute is written back untouched.
  renderMarkdown: (node: JSONContent) => rawNodeSource(node),
});
