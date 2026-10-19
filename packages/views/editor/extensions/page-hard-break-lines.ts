import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Lines that follow a hard break (Shift+Enter, imported or AI-written pages)
 * live inside one paragraph, so they are never the start of a block: the slash
 * picker's line-start check and every `^`-anchored Markdown input rule see the
 * text of the whole paragraph and refuse to fire (UNI-1954).
 *
 * When the user types a block trigger at the start of such a line, promote the
 * line to a paragraph of its own first, then replay the keystroke so the
 * picker and the input rules run exactly as on any other line. Only a typed
 * keystroke gets here (`handleTextInput`); pasted, dropped and loaded text is
 * left as it is.
 */
const PrefixPattern = /^(?:\d{1,9}[.)]|[-*+]|#{1,6}|>|\[[ xX]?\]|```[a-z]*) $/u;

const pluginKey = new PluginKey("pageHardBreakLines");

export const PageHardBreakLinesExtension = Extension.create({
  name: "pageHardBreakLines",
  priority: 1100,

  addProseMirrorPlugins() {
    let replaying = false;

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (replaying || !view.editable || !text) return false;
            const $from = view.state.doc.resolve(from);
            const block = $from.parent;
            if (!block.isTextblock || block.type.spec.code) return false;

            // The line so far: everything after the last hard break before the caret.
            let hardBreakPos = -1;
            let lineStart = 0;
            block.forEach((child, offset) => {
              if (offset >= $from.parentOffset) return;
              if (child.type.name === "hardBreak") {
                hardBreakPos = $from.start() + offset;
                lineStart = offset + child.nodeSize;
              }
            });
            if (hardBreakPos === -1) return false;
            const line = block.textBetween(lineStart, $from.parentOffset, undefined, "￼");
            // IME and `insertText` can deliver the whole `1. ` in one call, so match line + text.
            if (!(line === "" && text.startsWith("/")) && !PrefixPattern.test(line + text)) return false;

            const tr = view.state.tr.delete(hardBreakPos, hardBreakPos + 1).split(hardBreakPos);
            view.dispatch(tr);
            const newFrom = tr.mapping.map(from);
            const newTo = tr.mapping.map(to);
            const insert = () => view.state.tr.insertText(text, newFrom, newTo);
            replaying = true;
            try {
              const handled = view.someProp("handleTextInput", (handler) =>
                handler(view, newFrom, newTo, text, insert));
              if (!handled) view.dispatch(insert());
            } finally {
              replaying = false;
            }
            return true;
          },
        },
      }),
    ];
  },
});
