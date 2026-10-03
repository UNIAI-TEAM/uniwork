import {
  createShortcutChord,
  getShortcutPlatform,
  shortcutMatchesEvent,
  type ShortcutChord,
  type ShortcutModifiers,
  type ShortcutPlatform,
} from "@uniwork/core/shortcuts";

/**
 * The single declarative DOCX shortcut list, genoffice's `shortcuts.ts` shape
 * rebuilt on the UniWork chord machinery. The help dialog renders it and the
 * keydown controller resolves against it, so a binding added here shows up in
 * both without touching either file.
 *
 * Chords are logical: `primary` is Command on macOS and Control elsewhere, so
 * `Mod+S` is `⌘S` on a Mac and `Ctrl+S` on Windows/Linux. `macChords` replaces
 * `chords` on macOS for the few chords the platforms genuinely spell
 * differently. Only commands that exist in this lane are listed: A3
 * (paragraph), A8 (context menu), A10-A13 and the wave-B tasks are absent until
 * their commands land, and the wiring follow-up binds the handlers.
 */
export type DocxShortcutCategory = "file" | "edit" | "text" | "para" | "insert" | "view";

export interface DocxShortcutGroup {
  id: DocxShortcutCategory;
  labelKey: string;
}

/** Help-dialog section order. */
export const DOCX_SHORTCUT_GROUPS: readonly DocxShortcutGroup[] = [
  { id: "file", labelKey: "office.docx.shortcuts.groups.file" },
  { id: "edit", labelKey: "office.docx.shortcuts.groups.edit" },
  { id: "text", labelKey: "office.docx.shortcuts.groups.text" },
  { id: "para", labelKey: "office.docx.shortcuts.groups.para" },
  { id: "insert", labelKey: "office.docx.shortcuts.groups.insert" },
  { id: "view", labelKey: "office.docx.shortcuts.groups.view" },
];

export interface DocxShortcut<Id extends string = string> {
  id: Id;
  category: DocxShortcutCategory;
  /** i18n key under `office.docx.*`; every key exists in both locales. */
  labelKey: string;
  /** Interpolation values for the label (`headingLevel` carries `level`). */
  labelVars?: Readonly<Record<string, string>>;
  /** Chords on Windows/Linux, and on macOS unless `macChords` is set. The
   * first entry is the primary hint. */
  chords: readonly ShortcutChord[];
  /** macOS-only replacement when the two platforms spell the chord differently. */
  macChords?: readonly ShortcutChord[];
  /** A write command: the dialog marks it unavailable while the document is read-only. */
  write?: boolean;
  /** May fire while focus is in a text field (save, find, help). */
  global?: boolean;
}

const mod = (key: string, modifiers: Partial<ShortcutModifiers> = {}): ShortcutChord =>
  createShortcutChord(key, { primary: true, ...modifiers });

// Keys use the matcher's normalized spelling ("Equals", "Minus", "Space") so a
// chord compares equal to the key a real KeyboardEvent reports for it. The
// literal `as const` defs keep the id union below precise; the assignment to
// DOCX_SHORTCUTS then widens the optional fields back in, so consumers read
// `write`/`global` without per-entry narrowing.
const DOCX_SHORTCUT_DEFS = [
  // Document
  { id: "save", category: "file", labelKey: "office.docx.actions.save", chords: [mod("S")], global: true },
  { id: "find", category: "file", labelKey: "office.docx.find.label", chords: [mod("F")], global: true },
  { id: "help", category: "file", labelKey: "office.docx.shortcuts.title", chords: [mod("/")], global: true },

  // Editing
  { id: "undo", category: "edit", labelKey: "office.docx.actions.undo", chords: [mod("Z")] },
  // Word for Windows redoes on Ctrl+Y, the Mac on ⇧⌘Z; listing both keeps the
  // ⌘-side from advertising a chord macOS apps do not use.
  {
    id: "redo",
    category: "edit",
    labelKey: "office.docx.actions.redo",
    chords: [mod("Y"), mod("Z", { shift: true })],
    macChords: [mod("Z", { shift: true })],
  },
  { id: "selectAll", category: "edit", labelKey: "office.docx.shortcuts.actions.selectAll", chords: [mod("A")] },
  { id: "cut", category: "edit", labelKey: "office.docx.shortcuts.actions.cut", chords: [mod("X")] },
  { id: "copy", category: "edit", labelKey: "office.docx.shortcuts.actions.copy", chords: [mod("C")] },
  { id: "paste", category: "edit", labelKey: "office.docx.shortcuts.actions.paste", chords: [mod("V")] },

  // Character formatting
  { id: "bold", category: "text", labelKey: "office.docx.commands.bold", chords: [mod("B")], write: true },
  { id: "italic", category: "text", labelKey: "office.docx.commands.italic", chords: [mod("I")], write: true },
  { id: "underline", category: "text", labelKey: "office.docx.commands.underline", chords: [mod("U")], write: true },
  {
    id: "strike",
    category: "text",
    labelKey: "office.docx.shortcuts.actions.strike",
    chords: [mod("X", { shift: true })],
    write: true,
  },
  { id: "superscript", category: "text", labelKey: "office.docx.shortcuts.actions.superscript", chords: [mod(".")], write: true },
  { id: "subscript", category: "text", labelKey: "office.docx.shortcuts.actions.subscript", chords: [mod(",")], write: true },
  { id: "growFont", category: "text", labelKey: "office.docx.shortcuts.actions.growFont", chords: [mod("]")], write: true },
  { id: "shrinkFont", category: "text", labelKey: "office.docx.shortcuts.actions.shrinkFont", chords: [mod("[")], write: true },
  {
    id: "changeCase",
    category: "text",
    labelKey: "office.docx.shortcuts.actions.changeCase",
    chords: [createShortcutChord("F3", { shift: true })],
    write: true,
  },
  // Word clears character formatting on Ctrl+Space; on macOS the primary
  // modifier is Command, so the Mac keeps literal Control like Word for Mac.
  {
    id: "clearFormatting",
    category: "text",
    labelKey: "office.docx.shortcuts.actions.clearFormatting",
    chords: [mod("Space")],
    macChords: [createShortcutChord("Space", { control: true })],
    write: true,
  },
  {
    id: "copyFormat",
    category: "text",
    labelKey: "office.docx.shortcuts.actions.copyFormat",
    chords: [mod("C", { shift: true })],
    write: true,
  },
  {
    id: "pasteFormat",
    category: "text",
    labelKey: "office.docx.shortcuts.actions.pasteFormat",
    chords: [mod("V", { shift: true })],
    write: true,
  },

  // Paragraph formatting
  {
    id: "styleNormal",
    category: "para",
    labelKey: "office.docx.commands.headingParagraph",
    chords: [mod("0", { alt: true })],
    write: true,
  },
  {
    id: "heading1",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "1" },
    chords: [mod("1", { alt: true })],
    write: true,
  },
  {
    id: "heading2",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "2" },
    chords: [mod("2", { alt: true })],
    write: true,
  },
  {
    id: "heading3",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "3" },
    chords: [mod("3", { alt: true })],
    write: true,
  },
  {
    id: "heading4",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "4" },
    chords: [mod("4", { alt: true })],
    write: true,
  },
  {
    id: "heading5",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "5" },
    chords: [mod("5", { alt: true })],
    write: true,
  },
  {
    id: "heading6",
    category: "para",
    labelKey: "office.docx.commands.headingLevel",
    labelVars: { level: "6" },
    chords: [mod("6", { alt: true })],
    write: true,
  },
  {
    id: "bulletList",
    category: "para",
    labelKey: "office.docx.commands.bulletList",
    chords: [mod("8", { shift: true })],
    write: true,
  },
  {
    id: "orderedList",
    category: "para",
    labelKey: "office.docx.commands.orderedList",
    chords: [mod("7", { shift: true })],
    write: true,
  },

  // Insert
  { id: "insertLink", category: "insert", labelKey: "office.docx.links.insertTitle", chords: [mod("K")], write: true },

  // View
  { id: "zoomIn", category: "view", labelKey: "office.docx.view.zoom.in", chords: [mod("Equals")] },
  { id: "zoomOut", category: "view", labelKey: "office.docx.view.zoom.out", chords: [mod("Minus")] },
  { id: "zoomReset", category: "view", labelKey: "office.docx.shortcuts.actions.zoomReset", chords: [mod("0")] },
] as const;

/** Literal union of the declared ids, derived before the defs are widened. */
export type DocxShortcutId = (typeof DOCX_SHORTCUT_DEFS)[number]["id"];

/** The map every consumer reads; the assignment is the shape check. */
export const DOCX_SHORTCUTS: readonly DocxShortcut<DocxShortcutId>[] = DOCX_SHORTCUT_DEFS;

/** The chords a platform actually listens for; macOS may override the list. */
export function docxShortcutChords(shortcut: DocxShortcut, platform: ShortcutPlatform): readonly ShortcutChord[] {
  return platform === "macos" && shortcut.macChords ? shortcut.macChords : shortcut.chords;
}

/** The first entry whose chord matches the event. The map's uniqueness test
 * guarantees there is at most one, so "first" is only about determinism. */
export function resolveDocxShortcut(
  event: KeyboardEvent,
  platform: ShortcutPlatform = getShortcutPlatform(),
): DocxShortcut<DocxShortcutId> | null {
  for (const shortcut of DOCX_SHORTCUTS) {
    if (docxShortcutChords(shortcut, platform).some((chord) => shortcutMatchesEvent(chord, event, platform))) {
      return shortcut;
    }
  }
  return null;
}
