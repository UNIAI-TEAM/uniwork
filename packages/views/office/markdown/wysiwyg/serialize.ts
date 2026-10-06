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
import { getSchema } from "@tiptap/core";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { findFrontmatter } from "@uniwork/office-engine/markdown";
import { MARKDOWN_LEAD_ATTRIBUTE, MARKDOWN_LIST_INDENT } from "./extensions";
import { installSelectiveEscaper } from "./escape";
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
 * Split a source slice into the leading blank lines, the block source and the
 * trailing newlines the lexer absorbed. Only *newline* whitespace is treated
 * as a separator: a leading space inside a block is block content (an indented
 * code block), never a separator.
 *
 * The slice is always cut from the ORIGINAL bytes (see `newlineOffsetMap`), so
 * a `\r\n` separator stays `\r\n` and is never rewritten to `\n`.
 */
function splitBlockChunk(slice: string): BlockChunk {
  const lead = /^(?:[ \t]*\r?\n)+/.exec(slice)?.[0] ?? "";
  const rest = slice.slice(lead.length);
  const trail = /[\r\n]+$/.exec(rest)?.[0] ?? "";
  return { lead, core: rest.slice(0, rest.length - trail.length), trail };
}

/**
 * Marked's newline normalization, mirrored exactly so the offset map below is
 * built for the same text the lexer is handed.
 */
const CARRIAGE_RETURN = /\r\n|\r/g;

/**
 * Offset map from the newline-normalized text back to the original source.
 *
 * `Lexer.lex` starts with `src.replace(/\r\n|\r/g, "\n")`, so every token's
 * `raw` — and every `lead`/`core`/`trail` cut from it — would come from the
 * NORMALIZED text and silently drop the source's `\r` bytes. The mapping is
 * monotone: only `\r\n` and a lone `\r` collapse to one `\n`, so
 * `map[normalizedIndex]` is the source index of that normalized character and
 * `map[normalized.length]` is `source.length`. Lexing the normalized text and
 * cutting each block through `map` keeps the exact source bytes.
 */
function newlineOffsetMap(source: string): number[] {
  const map: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    map.push(index);
    if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
  }
  map.push(source.length);
  return map;
}

/**
 * Drop the boundary newlines the document serializer wraps a block in. A
 * single-block serialisation is `"\n" + block + "\n"` for a table; the block's
 * own leading/trailing blank lines are stored separately in `mdLead`.
 */
function trimBlockBoundaryNewlines(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Lex the source into top-level tokens, reusing the manager's marked instance.
 *
 * `manager.instance.lexer` is private API (`@tiptap/markdown` 3.30.6, marked
 * 17): the manager exposes no public lexer. The call is pinned by
 * `serialize.test.ts` ("pins the @tiptap/markdown internals"), which fails if
 * the member is renamed or stops being a function.
 *
 * The returned tokens tile the input exactly — marked's `blockTokens` advances
 * by `raw.length` and only ever appends to a previous token's `raw` — which is
 * what lets `toEditorDocument` map each `raw` back to a source range.
 */
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

/**
 * Node types that hold inline text, so `Selection.atStart` can land a caret in
 * them. Read from the manager's own extension set (the same one the editor
 * mounts with) and cached per manager: building a schema is not free and the
 * extension set never changes after construction.
 */
const textblockTypesCache = new WeakMap<MarkdownManager, Set<string>>();

function textblockTypes(manager: MarkdownManager): Set<string> {
  const cached = textblockTypesCache.get(manager);
  if (cached) return cached;
  // `baseExtensions` is private API (`@tiptap/markdown` 3.30.6), the same
  // manager already exposes `instance.lexer` privately (see `lexBlocks`). The
  // set only decides whether an empty paragraph is appended, so an empty
  // fallback keeps a caret home rather than losing bytes.
  const extensions = (manager as unknown as { baseExtensions?: AnyExtension[] }).baseExtensions;
  let types = new Set<string>();
  try {
    const schema = getSchema(extensions ?? []);
    types = new Set(
      Object.values(schema.nodes)
        .filter((type) => type.isTextblock)
        .map((type) => type.name),
    );
  } catch {
    types = new Set();
  }
  textblockTypesCache.set(manager, types);
  return types;
}

/**
 * True when some node in `nodes` (or a descendant) can hold a caret. Atoms
 * carry no `content` in the JSON, so recursing through `content` never enters a
 * raw block or a math atom - exactly the nodes `atStart` skips.
 */
function containsTextblock(nodes: JSONContent[], types: Set<string>): boolean {
  return nodes.some(
    (node) =>
      (typeof node.type === "string" && types.has(node.type)) || containsTextblock(node.content ?? [], types),
  );
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
 *
 * The lexer normalizes CR/CRLF to LF before tokenizing, so its tokens are
 * ranges in the NORMALIZED text, never in the source. Each token's range is
 * translated back through `newlineOffsetMap` and the `lead`/`core`/`trail` are
 * cut from the original bytes — otherwise every `\r` in the body would be
 * lost (frontmatter survives only because it is sliced before lexing).
 */
export function toEditorDocument(source: string, manager: MarkdownManager): JSONContent {
  const content: JSONContent[] = [];
  let body = source;
  const frontmatter = findFrontmatter(source);
  if (frontmatter) {
    content.push(rawBlock(source.slice(0, frontmatter.end), ""));
    body = source.slice(frontmatter.end);
  }

  const normalized = body.replace(CARRIAGE_RETURN, "\n");
  const offsets = newlineOffsetMap(body);
  const sliceOriginal = (from: number, to: number) => body.slice(offsets[from] ?? body.length, offsets[to] ?? body.length);

  let pending = "";
  let cursor = 0;
  for (const token of lexBlocks(manager, normalized)) {
    const raw = token.raw ?? "";
    const chunk = splitBlockChunk(sliceOriginal(cursor, cursor + raw.length));
    cursor += raw.length;
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

  // ProseMirror requires at least one block, and `Selection.atStart` needs a
  // TEXTBLOCK to land a caret in: with only atoms (front matter, raw HTML,
  // math) it returns `AllSelection`, and the first keystroke replaces the whole
  // document - the front matter is destroyed. Guarantee a caret home by
  // appending an empty paragraph whenever the parsed blocks hold no textblock.
  // The stored empty `mdLead` keeps the paragraph from injecting a separator,
  // and an empty paragraph serialises to "", so byte-identity is preserved.
  if (content.length === 0 || !containsTextblock(content, textblockTypes(manager))) {
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
    // A stored string is AUTHORITATIVE, `""` included: the source really had no
    // separator between this block and the previous one. Marked hands
    // `startBlock` callbacks `src.slice(1)`, so a one-character line followed by
    // `---`/`<!--`/`<tag` becomes two top-level tokens with no separator; that
    // stored `""` must stay empty. Only a `null`/`undefined` lead — a block the
    // user inserted after mount, which carries no source separator — wants the
    // default blank line.
    out +=
      typeof lead === "string"
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

/**
 * The Markdown manager bound to one extension set and the 4-space indent.
 *
 * The selective escaper is installed here, not only on the editor's manager:
 * `SelectiveMarkdown.onBeforeCreate` fires for a TipTap editor, but the codec
 * builds its own manager, so without this assignment `serialize()` (the write
 * path) would use the stock blanket escaper and pollute edited text with
 * backslashes. The editor's manager gets it via `SelectiveMarkdown`, which
 * runs the base `onBeforeCreate` first and then patches the rebuilt manager.
 */
export function createMarkdownSourceManager(extensions: AnyExtension[]): MarkdownManager {
  const manager = new MarkdownManager({ extensions, indentation: { style: "space", size: MARKDOWN_LIST_INDENT } });
  installSelectiveEscaper(manager);
  return manager;
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
