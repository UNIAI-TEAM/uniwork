import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export type CaseMode = "upper" | "lower" | "title" | "sentence";

/** The change-case menu also offers Word's toggling entry, which picks the
 * next mode off the selected text instead of taking one directly. */
export type CaseCommandMode = CaseMode | "toggle";

export function transformCase(value: string, mode: CaseMode): string {
  switch (mode) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      return value.toLowerCase().replace(/(^|\s)(\p{L})/gu, (match) => match.toUpperCase());
    case "sentence":
      return value.toLowerCase().replace(/(^\s*\p{L})|([.!?。!?]\s*\p{L})/gu, (match) => match.toUpperCase());
  }
}

/**
 * Word's Shift+F3 ring: lowercase → UPPERCASE → Capitalize Each Word. The
 * next step is read off the selection, so repeated presses walk the ring
 * (mixed-case text enters it at lowercase, like Word).
 */
export function caseModeForToggle(text: string): CaseMode {
  const letters = text.replace(/\P{L}/gu, "");
  if (!letters) return "lower";
  if (letters === letters.toLowerCase()) return "upper";
  if (letters === letters.toUpperCase()) return "title";
  return "lower";
}

/** The selection's text, used to decide where the ring resumes. */
export function selectionText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n", "\n");
}

/**
 * Rewrite every text run in the selection, keeping its marks. Ported from the
 * genoffice case transform: replacements are mapped as they are applied, and
 * the selection is restored (ß → SS and friends lengthen the phrase).
 */
export function applyCase(editor: Editor, mode: CaseMode): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText || !node.text) return;
        const start = Math.max(from, pos);
        const end = Math.min(to, pos + node.nodeSize);
        const slice = node.text.slice(start - pos, end - pos);
        const next = transformCase(slice, mode);
        if (next !== slice) {
          tr.replaceWith(tr.mapping.map(start), tr.mapping.map(end), state.schema.text(next, node.marks));
        }
      });
      if (tr.docChanged) {
        const grew = tr.doc.content.size - state.doc.content.size;
        tr.setSelection(TextSelection.create(tr.doc, from, to + grew));
      }
      return true;
    })
    .run();
}
