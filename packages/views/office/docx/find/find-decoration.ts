import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { FindMatch } from "./find-state";

export interface FindHighlight {
  matches: readonly FindMatch[];
  activeIndex: number;
}

/** The find panel's own plugin key. The vendored `docSearch` key is private to
 * the office-upstream bundle, so this module owns its highlight state. */
export const docxFindPluginKey = new PluginKey<DecorationSet>("uniwork-docx-find");

const HIT_CLASS = "search-hit";
const ACTIVE_HIT_CLASS = "search-hit search-hit-active";
const HIT_ATTRIBUTE = "data-docx-find";

export function buildFindDecorations(
  doc: ProseMirrorNode,
  matches: readonly FindMatch[],
  activeIndex: number,
): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === activeIndex ? ACTIVE_HIT_CLASS : HIT_CLASS,
        [HIT_ATTRIBUTE]: index === activeIndex ? "active" : "match",
      }),
    ),
  );
}

/** Decoration plugin: the panel pushes `{ matches, activeIndex }` through
 * transaction meta; every other document change maps the existing highlights. */
export function createDocxFindPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: docxFindPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, current) {
        const highlight = transaction.getMeta(docxFindPluginKey) as FindHighlight | undefined;
        if (highlight) return buildFindDecorations(transaction.doc, highlight.matches, highlight.activeIndex);
        if (transaction.docChanged) return current.map(transaction.mapping, transaction.doc);
        return current;
      },
    },
    props: {
      decorations(state) {
        return docxFindPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

/** Register the highlight plugin on a live editor. Returns the cleanup that
 * unregisters it (the host or the panel owns the lifetime). A document editor
 * already carries the plugin from the schema extension (find-extension.ts), so
 * there this is a no-op; a bare editor (tests, standalone use) registers it. */
export function mountDocxFindHighlight(editor: Editor): () => void {
  if (docxFindPluginKey.get(editor.state)) return () => {};
  editor.registerPlugin(createDocxFindPlugin());
  return () => {
    if (editor.isDestroyed) return;
    editor.unregisterPlugin(docxFindPluginKey);
  };
}

/** Show `matches` with `activeIndex` marked; an empty list clears them. */
export function applyDocxFindHighlight(editor: Editor, matches: readonly FindMatch[], activeIndex: number): void {
  if (editor.isDestroyed) return;
  const { tr } = editor.state;
  tr.setMeta(docxFindPluginKey, { matches, activeIndex } satisfies FindHighlight);
  editor.view.dispatch(tr);
}

export function clearDocxFindHighlight(editor: Editor): void {
  applyDocxFindHighlight(editor, [], 0);
}
