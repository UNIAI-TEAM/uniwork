/**
 * Markdown source <-> editor state.
 *
 * The contract (G3-08): the saved source is the raw text. Opening a document
 * and serialising it without an edit must return the exact same bytes — the
 * trailing newline, the blank lines between blocks, and every construct the
 * visual editor does not model (frontmatter, GFM tables, fences, raw HTML,
 * comments, footnote syntax) included. After one edit, every byte outside the
 * edited range must still be unchanged.
 *
 * `@tiptap/markdown` cannot do that on its own: its document serializer joins
 * blocks with a fixed blank line, re-indents nested content and re-escapes
 * text, so a faithful open->serialize already differs from the source. This
 * module keeps the bytes by splitting the job in two:
 *
 *   source -> editor state
 *     The source is lexed into top-level blocks. Each block that the editor can
 *     represent AND whose serialisation is byte-identical to its source slice
 *     becomes a normal node; every other block (frontmatter, raw HTML,
 *     comments, footnote syntax, tables the manager re-formats) becomes an
 *     opaque `markdownRaw` node carrying its exact source slice. The exact
 *     separator that preceded each block, and the document tail, are stored as
 *     the `mdLead` attribute (see extensions.ts).
 *
 *   editor state -> source
 *     Each node is rendered. A `markdownRaw` node emits its stored source
 *     untouched. A normal node that still serialises to its original text
 *     emits that original text; a node the user actually edited emits its new
 *     serialisation. Blocks are joined with their stored separator, so an edit
 *     changes only its own block.
 *
 * The split is lossless in both directions because the editor state is exactly
 * what `toEditorDocument` produced: the text a block had is either in a raw
 * node or recoverable from the node that represents it.
 */
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { AnyExtension } from "@tiptap/core";
import { findFrontmatter } from "@uniwork/office-engine/markdown";
import { MARKDOWN_LEAD_ATTRIBUTE, MARKDOWN_LIST_INDENT } from "./extensions";
import { MARKDOWN_RAW_NODE_NAME, rawNodeSource } from "./raw-node";

/** Separator used between blocks whose source had no explicit separator. */
export const MARKDOWN_DEFAULT_SEPARATOR = "\n\n";

/** Minimal shape of a marked top-level token. */
interface LexedToken {
  type?: string;
  raw?: string;
}

/** One lexed block, split into its separator, its core source and its trailing newlines. */
interface BlockChunk {
  lead: string;
  core: string;
  trail: string;
}

/**
 * Split a lexed token's `raw` into the leading blank lines, the block source
 * and the trailing newlines the lexer absorbed. Only *newline* whitespace is
 * treated as a separator: a leading space inside a block is block content
 * (an indented code block), never a separator.
 */
function splitBlockChunk(raw: string): BlockChunk {
  const lead = /^(?:[ \t]*\r?\n)+/.exec(raw)?.[0] ?? "";
  const rest = raw.slice(lead.length);
  const trail = /[\r\n]+$/.exec(rest)?.[0] ?? "";
  return { lead, core: rest.slice(0, rest.length - trail.length), trail };
}

/**
 * Drop the boundary newlines the document serializer wraps a block in. A
 * single-block serialisation is `"\n" + block + "\n"` for a table; the block's
 * own leading/trailing blank lines are stored separately in `mdLead`.
 */
function trimBlockBoundaryNewlines(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Lex the source into top-level tokens, reusing the manager's marked instance. */
function lexBlocks(manager: MarkdownManager, source: string): LexedToken[] {
  const lexer = manager.instance.lexer as unknown as (src: string) => LexedToken[];
  return lexer.call(manager.instance, source);
}

/**
 * The single block `core` parses to, when the editor can represent it AND its
 * serialisation is byte-identical to `core`. `null` means "keep it raw".
 */
function representableBlock(manager: MarkdownManager, core: string): JSONContent | null {
  let candidate: JSONContent;
  try {
    const parsed = manager.parse(core) as JSONContent;
    const content = parsed.content ?? [];
    // A single block only. A construct that splits into several blocks (or
    // none) would change the document structure, so it stays raw.
    if (content.length !== 1) return null;
    candidate = content[0] as JSONContent;
  } catch {
    return null;
  }
  const parent: JSONContent = { type: "doc", content: [candidate] };
  let rendered: string;
  try {
    rendered = manager.renderNodeToMarkdown(candidate, parent, 0, 0);
  } catch {
    return null;
  }
  // Byte-identical or raw: this is what makes an untouched document reopen
  // exactly as it was saved. A node the manager would re-format (a table's
  // padding, an escaped underscore) is never allowed to silently rewrite.
  return trimBlockBoundaryNewlines(rendered) === core ? candidate : null;
}

function rawBlock(source: string, lead: string): JSONContent {
  return {
    type: MARKDOWN_RAW_NODE_NAME,
    attrs: { source, [MARKDOWN_LEAD_ATTRIBUTE]: lead },
  };
}

/**
 * Parse Markdown source into the editor document, preserving every byte.
 *
 * YAML frontmatter is taken first (a `---` fence is not a thematic break when
 * it opens the file) and kept as one raw node; the rest is lexed and mapped
 * block by block.
 */
export function toEditorDocument(source: string, manager: MarkdownManager): JSONContent {
  const content: JSONContent[] = [];
  let body = source;
  const frontmatter = findFrontmatter(source);
  if (frontmatter) {
    content.push(rawBlock(source.slice(0, frontmatter.end), ""));
    body = source.slice(frontmatter.end);
  }

  let pending = "";
  for (const token of lexBlocks(manager, body)) {
    const chunk = splitBlockChunk(token.raw ?? "");
    pending += chunk.lead;
    if (chunk.core.length > 0) {
      const candidate = representableBlock(manager, chunk.core);
      if (candidate) {
        content.push({
          ...candidate,
          attrs: { ...(candidate.attrs ?? {}), [MARKDOWN_LEAD_ATTRIBUTE]: pending },
        });
      } else {
        content.push(rawBlock(chunk.core, pending));
      }
      pending = "";
    }
    pending += chunk.trail;
  }

  // ProseMirror requires at least one block; an empty or whitespace-only
  // source still round-trips because an empty paragraph serialises to "".
  if (content.length === 0) {
    content.push({ type: "paragraph", attrs: { [MARKDOWN_LEAD_ATTRIBUTE]: "" } });
  }

  return { type: "doc", attrs: { [MARKDOWN_LEAD_ATTRIBUTE]: pending }, content };
}

/**
 * Serialise the editor document back to Markdown source, byte-faithful.
 *
 * `parent` must be the document that owns `node` (for `previousNode` lookups);
 * the editor passes its own `getJSON()`.
 */
export function fromEditorDocument(doc: JSONContent, manager: MarkdownManager): string {
  const content = doc.content ?? [];
  let out = "";
  content.forEach((node, index) => {
    const lead = node.attrs?.[MARKDOWN_LEAD_ATTRIBUTE];
    out +=
      typeof lead === "string" && lead.length > 0
        ? lead
        : index === 0
          ? ""
          : MARKDOWN_DEFAULT_SEPARATOR;
    out +=
      node.type === MARKDOWN_RAW_NODE_NAME
        ? rawNodeSource(node)
        : trimBlockBoundaryNewlines(manager.renderNodeToMarkdown(node, doc, index, 0));
  });
  const tail = doc.attrs?.[MARKDOWN_LEAD_ATTRIBUTE];
  return out + (typeof tail === "string" ? tail : "");
}

/** The Markdown manager bound to one extension set and the 4-space indent. */
export function createMarkdownSourceManager(extensions: AnyExtension[]): MarkdownManager {
  return new MarkdownManager({ extensions, indentation: { style: "space", size: MARKDOWN_LIST_INDENT } });
}

/** The parse/serialise pair an editor mounts with, bound to one extension set. */
export interface MarkdownSourceCodec {
  parse(source: string): JSONContent;
  serialize(doc: JSONContent): string;
}

/**
 * Build the codec over the Markdown editor's extension set. The manager must
 * be the same one the TipTap editor uses (same extensions, same indentation),
 * or parse and serialise would disagree on which blocks are representable.
 */
export function createMarkdownSourceCodec(extensions: AnyExtension[]): MarkdownSourceCodec {
  const manager = createMarkdownSourceManager(extensions);
  return {
    parse: (source) => toEditorDocument(source, manager),
    serialize: (doc) => fromEditorDocument(doc, manager),
  };
}
