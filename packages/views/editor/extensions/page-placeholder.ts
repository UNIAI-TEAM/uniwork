import Placeholder from "@tiptap/extension-placeholder";
import type { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A single decoration follows the selected paragraph, including nested lists. */
export function createPagePlaceholder(placeholder?: string | ((props: { editor: Editor }) => string)) {
  return Placeholder.extend({
    addProseMirrorPlugins() {
      const { editor } = this;
      return [new Plugin({
        props: {
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            const { $from, empty } = state.selection;
            const node = $from.parent;
            if (!empty || !$from.depth || !node.isTextblock || node.content.size || node.type.name === "codeBlock") return DecorationSet.empty;
            const pos = $from.before($from.depth);
            const text = typeof placeholder === "function" ? placeholder({ editor }) : placeholder ?? "";
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, {
              class: editor.isEmpty ? "is-empty is-editor-empty" : "is-empty",
              "data-placeholder": text,
            })]);
          },
        },
      })];
    },
  });
}
