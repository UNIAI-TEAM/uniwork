/**
 * Markdown find highlight — the pure half (M7).
 *
 * The WYSIWYG editor renders a ProseMirror document, not the raw Markdown, so
 * a match offset the panel reports for the SOURCE cannot be used as a document
 * position. This module does the two things that need no React:
 *
 *   1. `flattenDocText` walks the document into a flat string plus a parallel
 *      position map (`positions[i]` is the document position of `text[i]`, or
 *      `null` for a block separator). `matchToPmRange` turns a match range in
 *      that flat string back into a document range.
 *   2. A ProseMirror plugin paints one inline decoration per range, with the
 *      active match carrying its own class/attribute so it is distinguishable.
 *
 * Nothing here searches: the ranges come from the shared S4 matcher through the
 * panel's `onResultChange`, so there is exactly one matcher in the product.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { FindMatch } from "../../common/find";

/** Painted on every match. */
const MATCH_CLASS = "md-find-match";
/** Painted on the active match as well, so it stands out from the rest. */
const ACTIVE_CLASS = "md-find-match-active";
/** Marker attributes so the DOM can be asserted without reading classes. */
const MATCH_ATTRIBUTE = "data-find-match";
const ACTIVE_ATTRIBUTE = "data-find-active";
/**
 * Inline paint, using the semantic token slots rather than a hardcoded colour.
 * Inline (not a stylesheet rule) because this task owns only the `find*` files
 * and must not edit a global stylesheet; the token custom properties are
 * inherited, so `var(--warning-soft)` resolves in both themes.
 */
const MATCH_STYLE = "background-color: var(--warning-soft);";
const ACTIVE_STYLE = "background-color: var(--brand); color: var(--brand-foreground);";

export interface MarkdownFindRange {
  readonly from: number;
  readonly to: number;
}

export interface MarkdownFindHighlight {
  readonly ranges: readonly MarkdownFindRange[];
  /** Index into `ranges` of the active match, or -1 for none. */
  readonly activeIndex: number;
}

const EMPTY_MARKDOWN_FIND_HIGHLIGHT: MarkdownFindHighlight = { ranges: [], activeIndex: -1 };

export interface FlattenedDoc {
  readonly text: string;
  /** Document position of each code unit of `text`; `null` for a separator. */
  readonly positions: readonly (number | null)[];
}

export const EMPTY_FLATTENED_DOC: FlattenedDoc = { text: "", positions: [] };

/** A leaf with no text (an image, a rule) still occupies one flat character. */
const LEAF_PLACEHOLDER = "\uFFFC";
/** One block separator in the flat text, mirroring `textBetween`'s default. */
const BLOCK_SEPARATOR = "\n";
/** The opaque raw node (raw-node.ts), whose text lives in its `source` attr. */
const RAW_NODE_NAME = "markdownRaw";

/**
 * True when a raw block's source is a GFM table, i.e. the shape the WYSIWYG
 * surface DRAWS as a real table (see `parseGfmTable` in editor.tsx). This is a
 * local, read-only shape check, not a second parser: it only decides whether
 * the block's text should be searchable.
 */
function looksLikeGfmTable(source: string): boolean {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  const header = lines[0];
  const delimiter = lines[1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.trim().startsWith("|") || !delimiter.trim().startsWith("|")) return false;
  const cells = delimiter.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/**
 * The source of a raw GFM-table block, or null when the node is not one. An
 * authored table is kept as an opaque `markdownRaw` node for byte-identity, so
 * its cells are only in the `source` attribute - the flattened document would
 * otherwise carry a single placeholder and a search for a cell would miss it.
 */
function rawTableSource(node: PMNode): string | null {
  if (node.type.name !== RAW_NODE_NAME) return null;
  const source = node.attrs.source;
  return typeof source === "string" && looksLikeGfmTable(source) ? source : null;
}

function appendLeaf(out: { text: string; positions: (number | null)[] }, leaf: string, pos: number): void {
  for (let i = 0; i < leaf.length; i += 1) {
    out.text += leaf[i];
    // A text node's i-th code unit sits at `pos + i`; pushing `pos` for every
    // character would collapse a whole node onto its first position and make
    // every match inside it resolve to a one-character range.
    out.positions.push(pos + i);
  }
}

/**
 * The document as one string, with a map back to document positions. Block
 * children are joined with `\n`, exactly like `textBetween(0, size, "\n")`, so
 * a query never matches across two blocks by accident: the separator is a
 * `null` position and `matchToPmRange` drops a range that spans one.
 */
export function flattenDocText(doc: PMNode): FlattenedDoc {
  const out: { text: string; positions: (number | null)[] } = { text: "", positions: [] };
  const walk = (node: PMNode, pos: number): void => {
    if (node.isText) {
      appendLeaf(out, node.text ?? "", pos);
      return;
    }
    if (node.isLeaf) {
      const table = rawTableSource(node);
      if (table !== null) {
        // Searchable but not mappable: every code unit gets a `null` position,
        // so a match inside the table is counted and stepped through, while
        // `matchToPmRange` still refuses it. The node is content-less, so there
        // is no per-character document range to paint or to replace - replacing
        // would rewrite the whole opaque block.
        for (let i = 0; i < table.length; i += 1) {
          out.text += table[i];
          out.positions.push(null);
        }
        return;
      }
      appendLeaf(out, node.type.spec.leafText?.(node) ?? LEAF_PLACEHOLDER, pos);
      return;
    }
    // The doc's children start at position 0; every other node's content starts
    // one position past the node itself.
    const base = node.type.name === "doc" ? pos : pos + 1;
    node.forEach((child, offset, index) => {
      // The separator belongs between two BLOCK children, so the condition is
      // the child's, not the parent's: the doc node is not itself a block, and
      // keying on `node.isBlock` would silently concatenate every top-level
      // block (`# Title` + `one two one` -> `Titleone two one`).
      if (index > 0 && child.isBlock) {
        out.text += BLOCK_SEPARATOR;
        out.positions.push(null);
      }
      walk(child, base + offset);
    });
  };
  walk(doc, 0);
  return out;
}

/**
 * The document range for a match in the flat text, or `null` when the match
 * spans a block separator (a decoration cannot span two nodes, and a replace
 * across one would splice two top-level blocks together).
 */
export function matchToPmRange(flat: FlattenedDoc, match: FindMatch): MarkdownFindRange | null {
  // EVERY code unit in the match must map, not just the endpoints. A regex
  // match can span an INTERIOR separator (`e\no` over `Title\none`): the
  // endpoint check alone waves it through, and the caller's `replaceWith` then
  // replaces across the separator and merges the two blocks.
  let from = -1;
  let to = -1;
  for (let i = match.start; i < match.end; i += 1) {
    const position = flat.positions[i];
    if (position === undefined || position === null) return null;
    if (from === -1) from = position;
    to = position + 1;
  }
  if (from === -1) return null;
  return { from, to };
}

/**
 * Map every match to a document range, keeping the active match's identity.
 * Matches that cannot be mapped are dropped; `activeIndex` is recomputed as the
 * position of the active match inside the surviving list, or -1.
 */
export function buildMarkdownFindHighlight(
  flat: FlattenedDoc,
  matches: readonly FindMatch[],
  activeIndex: number,
): MarkdownFindHighlight {
  const ranges: MarkdownFindRange[] = [];
  let mappedActive = -1;
  matches.forEach((match, index) => {
    const range = matchToPmRange(flat, match);
    if (!range) return;
    if (index === activeIndex) mappedActive = ranges.length;
    ranges.push(range);
  });
  return { ranges, activeIndex: mappedActive };
}

export const markdownFindPluginKey = new PluginKey<MarkdownFindHighlight>("markdownFindHighlight");

/** The decoration plugin. Registered at runtime so M1's extension set is untouched. */
export function createMarkdownFindPlugin(): Plugin<MarkdownFindHighlight> {
  return new Plugin<MarkdownFindHighlight>({
    key: markdownFindPluginKey,
    state: {
      init: () => EMPTY_MARKDOWN_FIND_HIGHLIGHT,
      apply: (tr, value) => (tr.getMeta(markdownFindPluginKey) as MarkdownFindHighlight | undefined) ?? value,
    },
    props: {
      decorations(state) {
        const highlight = markdownFindPluginKey.getState(state) ?? EMPTY_MARKDOWN_FIND_HIGHLIGHT;
        if (highlight.ranges.length === 0) return DecorationSet.empty;
        // A stale highlight can outlive the document it was built for (a
        // replacement shrinks it before the host repaints); a range past the
        // end would make `DecorationSet.create` throw, so drop those.
        const size = state.doc.content.size;
        const live = highlight.ranges
          .map((range, index) => ({ range, index }))
          .filter(({ range }) => range.from >= 0 && range.from < range.to && range.to <= size);
        if (live.length === 0) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          live.map(({ range, index }) =>
            index === highlight.activeIndex
              ? Decoration.inline(range.from, range.to, {
                  class: `${MATCH_CLASS} ${ACTIVE_CLASS}`,
                  style: ACTIVE_STYLE,
                  [MATCH_ATTRIBUTE]: "1",
                  [ACTIVE_ATTRIBUTE]: "1",
                })
              : Decoration.inline(range.from, range.to, {
                  class: MATCH_CLASS,
                  style: MATCH_STYLE,
                  [MATCH_ATTRIBUTE]: "1",
                }),
          ),
        );
      },
    },
  });
}

/**
 * Push a highlight into the editor.
 *
 * `addToHistory: false` keeps a paint-only change out of the undo stack.
 * `preventUpdate: true` is load-bearing: the transaction carries no document
 * change of its own, but TrailingNode (`@tiptap/extensions`, in the shared
 * editor's extension set) appends an empty paragraph on EVERY dispatched
 * transaction whose last block is not a paragraph. That appended step makes the
 * transaction `docChanged`, so without this meta TipTap fires `update` and M1
 * re-publishes the source - a find-highlight clear at mount would rewrite the
 * text port with `source + "\n\n"` and mark the document dirty for bytes the
 * user never wrote. The meta suppresses `update` even when an appended
 * transaction changed the doc (see `dispatchTransaction` in `@tiptap/core`), so
 * the paint never publishes.
 */
export function applyMarkdownFindHighlight(editor: Editor, highlight: MarkdownFindHighlight): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta("addToHistory", false)
      .setMeta("preventUpdate", true)
      .setMeta(markdownFindPluginKey, highlight),
  );
}

export function clearMarkdownFindHighlight(editor: Editor): void {
  applyMarkdownFindHighlight(editor, EMPTY_MARKDOWN_FIND_HIGHLIGHT);
}
