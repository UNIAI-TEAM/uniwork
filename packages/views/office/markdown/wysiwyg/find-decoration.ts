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
export const MARKDOWN_FIND_MATCH_CLASS = "md-find-match";
/** Painted on the active match as well, so it stands out from the rest. */
export const MARKDOWN_FIND_ACTIVE_CLASS = "md-find-match-active";
/** Marker attribute so the DOM can be asserted without reading classes. */
export const MARKDOWN_FIND_MATCH_ATTRIBUTE = "data-find-match";
export const MARKDOWN_FIND_ACTIVE_ATTRIBUTE = "data-find-active";

export interface MarkdownFindRange {
  readonly from: number;
  readonly to: number;
}

export interface MarkdownFindHighlight {
  readonly ranges: readonly MarkdownFindRange[];
  /** Index into `ranges` of the active match, or -1 for none. */
  readonly activeIndex: number;
}

export const EMPTY_MARKDOWN_FIND_HIGHLIGHT: MarkdownFindHighlight = { ranges: [], activeIndex: -1 };

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

function appendLeaf(out: { text: string; positions: (number | null)[] }, leaf: string, pos: number): void {
  for (let i = 0; i < leaf.length; i += 1) {
    out.text += leaf[i];
    out.positions.push(pos);
  }
}

/**
 * The document as one string, with a map back to document positions. Block
 * children are joined with `\n`, exactly like `textBetween(0, size, "\n")`, so
 * a query never matches across two blocks by accident: the separator is a
 * `null` position and `matchToPmRange` drops a range that touches one.
 */
export function flattenDocText(doc: PMNode): FlattenedDoc {
  const out: { text: string; positions: (number | null)[] } = { text: "", positions: [] };
  const walk = (node: PMNode, pos: number): void => {
    if (node.isText) {
      appendLeaf(out, node.text ?? "", pos);
      return;
    }
    if (node.isLeaf) {
      appendLeaf(out, node.type.spec.leafText?.(node) ?? LEAF_PLACEHOLDER, pos);
      return;
    }
    // The doc's children start at position 0; every other node's content starts
    // one position past the node itself.
    const base = node.type.name === "doc" ? pos : pos + 1;
    node.forEach((child, offset, index) => {
      if (index > 0 && node.isBlock) {
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
 * starts or ends on a block separator (a decoration cannot span two nodes).
 */
export function matchToPmRange(flat: FlattenedDoc, match: FindMatch): MarkdownFindRange | null {
  const from = flat.positions[match.start];
  const last = flat.positions[match.end - 1];
  if (from === undefined || from === null || last === undefined || last === null) return null;
  return { from, to: last + 1 };
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
        return DecorationSet.create(
          state.doc,
          highlight.ranges.map((range, index) =>
            index === highlight.activeIndex
              ? Decoration.inline(range.from, range.to, {
                  class: `${MARKDOWN_FIND_MATCH_CLASS} ${MARKDOWN_FIND_ACTIVE_CLASS}`,
                  [MARKDOWN_FIND_MATCH_ATTRIBUTE]: "1",
                  [MARKDOWN_FIND_ACTIVE_ATTRIBUTE]: "1",
                })
              : Decoration.inline(range.from, range.to, {
                  class: MARKDOWN_FIND_MATCH_CLASS,
                  [MARKDOWN_FIND_MATCH_ATTRIBUTE]: "1",
                }),
          ),
        );
      },
    },
  });
}

/**
 * Push a highlight into the editor. `addToHistory: false` keeps a paint-only
 * change out of the undo stack; the transaction carries no document change, so
 * it never fires `onUpdate` and M1 never re-publishes the source for it.
 */
export function applyMarkdownFindHighlight(editor: Editor, highlight: MarkdownFindHighlight): void {
  editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false).setMeta(markdownFindPluginKey, highlight));
}

export function clearMarkdownFindHighlight(editor: Editor): void {
  applyMarkdownFindHighlight(editor, EMPTY_MARKDOWN_FIND_HIGHLIGHT);
}
