import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { createSuggestionPopupRender } from "./suggestion-popup";
import { PageBlockList, type PageBlockListHandle } from "./page-block-list";
import { filterPageBlocks, insertPageBlock, type PageBlock, type PageTranslate } from "./page-blocks";

const PageSlashKey = new PluginKey("pageDocumentSlash");

export function createPageSlashExtension(options: { translate: PageTranslate; chooseImage: () => void }) {
  return Extension.create({
    name: "pageDocumentSlash",
    addProseMirrorPlugins() {
      return [Suggestion<PageBlock>({
        editor: this.editor,
        pluginKey: PageSlashKey,
        char: "/",
        allowedPrefixes: null,
        allow: ({ editor, state, range }) => {
          if (!editor.isEditable || state.selection.$from.parent.type.name === "codeBlock") return false;
          const before = state.doc.resolve(range.from);
          return before.parent.isTextblock && (before.parentOffset === 0 || /\s/u.test(before.parent.textBetween(0, before.parentOffset).at(-1) ?? ""));
        },
        items: ({ query }) => filterPageBlocks(query, options.translate),
        command: ({ editor, range, props }) => insertPageBlock(editor, range, props.id, options.chooseImage),
        render: createSuggestionPopupRender({
          pluginKey: PageSlashKey,
          component: PageBlockList,
          getProps: (props) => ({ items: props.items, editor: props.editor, command: props.command }),
          onKeyDown: (ref: PageBlockListHandle | null | undefined, { event }) => ref?.onKeyDown(event) ?? false,
        }),
      })];
    },
  });
}
