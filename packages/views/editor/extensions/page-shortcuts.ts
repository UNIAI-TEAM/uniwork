import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  createShortcutChord,
  DOCUMENT_EDITOR_SCOPE,
  DOCUMENT_EDITOR_SCOPE_ATTRIBUTE,
  getShortcutPlatform,
  shortcutMatchesEvent,
  type ShortcutChord,
  type ShortcutPlatform,
} from "@uniwork/core/shortcuts";
import { isImeComposing } from "@uniwork/core/utils";
import { PAGE_LINK_REQUEST_EVENT, PAGE_SAVE_REQUEST_EVENT } from "./page-events";

export type PageShortcutId =
  | "undo" | "redo" | "bold" | "italic" | "underline" | "strike" | "code" | "link" | "clearFormatting" | "save"
  | "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock"
  | "paragraph" | "heading1" | "heading2" | "heading3";

interface PageKey {
  chord: ShortcutChord;
  /** Limits the key to macOS or to every other platform; absent means both. */
  platform?: "mac" | "other";
  /**
   * The ProseMirror key name of a binding that comes with Tiptap's stock
   * keymaps. Absent means this extension owns the key (see `OWNED_ACTIONS`).
   */
  pm?: string;
}

const mod = (key: string, extra: { shift?: boolean; alt?: boolean } = {}) =>
  createShortcutChord(key, { primary: true, ...extra });

/**
 * The page editor's keys, one table for the handlers, the toolbar tooltips and
 * the help popover. UniNote follows Word for the web, so the Microsoft key of
 * each row comes first (the tooltip prints the first key that applies to the
 * platform) and the older UniWork key stays behind it as a secondary key.
 * `page-shortcuts.test.ts` fires every key against the real editor.
 */
export const PAGE_SHORTCUTS: Readonly<Record<PageShortcutId, readonly PageKey[]>> = {
  undo: [{ chord: mod("Z"), pm: "Mod-z" }],
  redo: [{ chord: mod("Y"), pm: "Mod-y" }, { chord: mod("Z", { shift: true }), pm: "Mod-Shift-z" }],
  bold: [{ chord: mod("B"), pm: "Mod-b" }],
  italic: [{ chord: mod("I"), pm: "Mod-i" }],
  underline: [{ chord: mod("U"), pm: "Mod-u" }],
  // Windows and Linux: Word prints no key, so the old chord stays. Mac: Word's
  // Cmd+Shift+X comes first and Cmd+Shift+S (Word's Save As) stays as a secondary key.
  strike: [
    { chord: mod("X", { shift: true }), platform: "mac" },
    { chord: mod("S", { shift: true }), pm: "Mod-Shift-s" },
  ],
  code: [{ chord: mod("E"), pm: "Mod-e" }],
  link: [{ chord: mod("K") }],
  // Word: Ctrl+Space. On macOS Control+Space is the input-source switch, and
  // Word for Mac prints no key, so there is none.
  clearFormatting: [{ chord: mod("Space"), platform: "other" }],
  save: [{ chord: mod("S") }],
  // Word for the web: Ctrl+. and Ctrl+/ on Windows and Linux, nothing documented on
  // Mac, so Cmd+Shift+8/7 stay the Mac keys. Ctrl+Shift+L (Word desktop) stays as a
  // secondary key off the Mac, where Cmd+Shift+L is Safari's sidebar.
  bulletList: [
    { chord: mod("."), platform: "other" },
    { chord: mod("L", { shift: true }), platform: "other" },
    { chord: mod("8", { shift: true }), pm: "Mod-Shift-8" },
  ],
  orderedList: [{ chord: mod("/"), platform: "other" }, { chord: mod("7", { shift: true }), pm: "Mod-Shift-7" }],
  taskList: [{ chord: mod("9", { shift: true }), pm: "Mod-Shift-9" }],
  blockquote: [{ chord: mod("B", { shift: true }), pm: "Mod-Shift-b" }],
  codeBlock: [{ chord: mod("C", { alt: true }), pm: "Mod-Alt-c" }],
  paragraph: [{ chord: mod("0", { alt: true }), pm: "Mod-Alt-0" }],
  heading1: [{ chord: mod("1", { alt: true }), pm: "Mod-Alt-1" }],
  heading2: [{ chord: mod("2", { alt: true }), pm: "Mod-Alt-2" }],
  heading3: [{ chord: mod("3", { alt: true }), pm: "Mod-Alt-3" }],
};

function appliesTo(key: PageKey, platform: ShortcutPlatform): boolean {
  if (!key.platform) return true;
  return (key.platform === "mac") === (platform === "macos");
}

/** The keys of `id` on `platform`, preferred first. */
export function pageShortcutChords(
  id: PageShortcutId,
  platform: ShortcutPlatform = getShortcutPlatform(),
): ShortcutChord[] {
  return PAGE_SHORTCUTS[id].filter((key) => appliesTo(key, platform)).map((key) => key.chord);
}

const FORMATTING_MARKS = ["bold", "italic", "underline", "strike", "code"];

/** What each key this extension owns does. Links stay: Word's Ctrl+Space keeps hyperlinks too. */
const OWNED_ACTIONS: Partial<Record<PageShortcutId, (editor: Editor) => boolean>> = {
  save: (editor) => {
    editor.view.dom.dispatchEvent(new CustomEvent(PAGE_SAVE_REQUEST_EVENT, { bubbles: true }));
    return true;
  },
  link: (editor) => {
    editor.view.dom.dispatchEvent(new CustomEvent(PAGE_LINK_REQUEST_EVENT, { bubbles: true }));
    return true;
  },
  bulletList: (editor) => editor.chain().focus().toggleBulletList().run(),
  orderedList: (editor) => editor.chain().focus().toggleOrderedList().run(),
  strike: (editor) => editor.chain().focus().toggleStrike().run(),
  clearFormatting: (editor) => {
    const chain = editor.chain().focus();
    for (const mark of FORMATTING_MARKS) chain.unsetMark(mark);
    return chain.run();
  },
};

/**
 * Chords the global shell or the browser would act on while the editor has
 * focus, claimed as no-ops so neither does: Ctrl/Cmd+J (Word's Justify, which
 * UniNote does not have yet, uninote-031; a future Justify takes this chord
 * instead of the no-op, otherwise it would open Downloads), and Ctrl/Cmd+[ and
 * Ctrl/Cmd+] (Word's font size; Cmd+[ is history back in Chrome and Safari).
 * Ctrl+B (Bold) and Ctrl+K (link) are real bindings above.
 */
const CLAIMED_NO_OPS: readonly ShortcutChord[] = [mod("J"), mod("["), mod("]")];

/**
 * Marks the page editor as a document-editor scope, so global chords that are
 * also Word chords (Ctrl+K, Ctrl+J, Ctrl+[ ]) stand down while it has focus,
 * and binds the keys of `PAGE_SHORTCUTS` that Tiptap does not bring itself:
 * Ctrl/Cmd+S (stops the browser's "Save page" and asks the view to flush the
 * autosave), Ctrl/Cmd+K (link), Ctrl+. and Ctrl+/ (lists), Ctrl+Shift+L, Ctrl+Space
 * and Cmd+Shift+X (Mac strikethrough); `CLAIMED_NO_OPS` keep the browser out.
 *
 * The keys are matched from the event, not from Tiptap's `Mod` (which reads
 * the platform once at load): AltGr and IME composition never match. Mention
 * and slash pickers run at a higher priority, so an open picker keeps its
 * own Ctrl+K.
 */
export const PageShortcutsExtension = Extension.create({
  name: "pageShortcuts",
  addProseMirrorPlugins() {
    const editor = this.editor;
    const owned = (Object.keys(PAGE_SHORTCUTS) as PageShortcutId[]).flatMap((id) => {
      const action = OWNED_ACTIONS[id];
      return action ? PAGE_SHORTCUTS[id].filter((key) => !key.pm).map((key) => ({ key, action })) : [];
    });
    return [
      new Plugin({
        props: {
          attributes: { [DOCUMENT_EDITOR_SCOPE_ATTRIBUTE]: DOCUMENT_EDITOR_SCOPE },
          handleKeyDown(view, event) {
            if (!editor.isEditable || view.composing || isImeComposing(event)) return false;
            const platform = getShortcutPlatform();
            for (const { key, action } of owned) {
              if (appliesTo(key, platform) && shortcutMatchesEvent(key.chord, event, platform)) {
                // A held key repeats: swallow it so the browser's own chord
                // (Save page) never fires between presses, but act once.
                return event.repeat || action(editor);
              }
            }
            return CLAIMED_NO_OPS.some((chord) => shortcutMatchesEvent(chord, event, platform));
          },
        },
      }),
    ];
  },
});
