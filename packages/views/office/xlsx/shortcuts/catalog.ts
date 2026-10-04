// Wave A / A9 (UNI-926): the shortcuts map/help catalog. ONE static module is
// the single source of truth for the dialog, so tests can pin the shape and the
// dialog stays a pure renderer. The chords use the shared `@uniwork/core`
// shortcut chord type, so platform rendering (Ctrl vs Cmd) comes from the same
// tested `formatShortcut` the rest of the product uses.
//
// Curated, not extracted from the vendored bundle: it lists only shortcuts the
// editor or the pinned Univer sheets UI actually binds today - the standard
// editing/navigation/formatting/sheet/zoom keys plus the editor's own Save
// (Ctrl+S) and this dialog's Help (Shift+/). A shortcut that is not wired is
// not listed, so the help never promises something that does not work.

import { createShortcutChord, type ShortcutChord } from "@uniwork/core/shortcuts";

/** The dialog's grouping, in display order. */
export type XlsxShortcutCategory = "general" | "navigation" | "editing" | "formatting" | "sheets" | "view";

export const XLSX_SHORTCUT_CATEGORIES: readonly XlsxShortcutCategory[] = [
  "general",
  "navigation",
  "editing",
  "formatting",
  "sheets",
  "view",
];

/** One row of the help: a localized label plus one or more chords (an action
 *  may accept alternatives, e.g. Redo = Ctrl+Y or Ctrl+Shift+Z). */
export interface XlsxShortcutEntry {
  readonly id: string;
  readonly category: XlsxShortcutCategory;
  /** i18n key under `office.xlsx.shortcuts.items.*`. */
  readonly labelKey: string;
  readonly chords: readonly ShortcutChord[];
}

const primary = (key: string) => createShortcutChord(key, { primary: true });
const plain = (key: string) => createShortcutChord(key);
const shiftPrimary = (key: string) => createShortcutChord(key, { primary: true, shift: true });

function entry(id: string, category: XlsxShortcutCategory, chords: readonly ShortcutChord[]): XlsxShortcutEntry {
  return { id, category, labelKey: `office.xlsx.shortcuts.items.${id}`, chords };
}

/** A curated map of the editor's own shortcuts. */
export const XLSX_SHORTCUTS: readonly XlsxShortcutEntry[] = [
  entry("save", "general", [primary("S")]),
  entry("undo", "general", [primary("Z")]),
  entry("redo", "general", [primary("Y"), shiftPrimary("Z")]),
  entry("find", "general", [primary("F")]),

  entry("moveUp", "navigation", [plain("Up")]),
  entry("moveDown", "navigation", [plain("Down")]),
  entry("moveLeft", "navigation", [plain("Left")]),
  entry("moveRight", "navigation", [plain("Right")]),
  entry("moveToEdge", "navigation", [createShortcutChord("Down", { primary: true })]),
  entry("selectAll", "navigation", [primary("A")]),
  entry("nextSheet", "navigation", [createShortcutChord("PageDown", { primary: true })]),
  entry("previousSheet", "navigation", [createShortcutChord("PageUp", { primary: true })]),

  entry("editCell", "editing", [plain("Enter"), plain("F2")]),
  entry("cancelEdit", "editing", [plain("Escape")]),
  entry("cut", "editing", [primary("X")]),
  entry("copy", "editing", [primary("C")]),
  entry("paste", "editing", [primary("V")]),
  entry("clearContent", "editing", [plain("Delete")]),

  entry("bold", "formatting", [primary("B")]),
  entry("italic", "formatting", [primary("I")]),
  entry("underline", "formatting", [primary("U")]),

  entry("insertSheet", "sheets", [createShortcutChord("F11", { shift: true })]),

  // The pinned sheets-ui binds zoom in to Ctrl+= (KeyCode.EQUAL), not the
  // shifted Ctrl+Plus: on most layouts Ctrl+Plus never reaches the page.
  entry("zoomIn", "view", [primary("Equals")]),
  entry("zoomOut", "view", [primary("Minus")]),
];

/** Case-insensitive substring filter over the localized labels. Pure: the
 *  dialog passes `t` so the catalog itself owns no i18n. */
export function filterShortcutEntries(
  entries: readonly XlsxShortcutEntry[],
  query: string,
  labelOf: (entry: XlsxShortcutEntry) => string,
): readonly XlsxShortcutEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((item) => labelOf(item).toLocaleLowerCase().includes(needle));
}

/** The entries for one category, preserving the catalog's order. */
export function shortcutEntriesForCategory(
  entries: readonly XlsxShortcutEntry[],
  category: XlsxShortcutCategory,
): readonly XlsxShortcutEntry[] {
  return entries.filter((item) => item.category === category);
}