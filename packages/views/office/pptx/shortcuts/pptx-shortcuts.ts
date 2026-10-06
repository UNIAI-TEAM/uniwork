/**
 * A7 (UNI-927) - the PPTX keyboard map, as pure data.
 *
 * One table owns every chord the slide canvas answers: the editor dispatches
 * through it and the help dialog lists it, so a key that is listed is a key that
 * runs and a key that runs is listed. A chord appears here only when the action
 * behind it exists on this surface today (a ribbon command id, the selection
 * controller, or slide navigation); an unbound command stays out of the map
 * instead of advertising a dead key.
 *
 * `primary` is Ctrl on Windows/Linux and Command on macOS. Input accepts either
 * one on every platform (the editor always did); only the displayed keycap
 * follows the detected platform.
 */
import type { PptxCommandId } from "../command-map";

export type PptxShortcutAction =
  | "undo"
  | "redo"
  | "save"
  | "find"
  | "edit-text"
  | "select-all"
  | "delete-selection"
  | "next-slide"
  | "previous-slide"
  | "dismiss"
  | "shortcuts-help";

export type PptxShortcutGroup = "editing" | "view" | "navigation";

export interface PptxShortcutChord {
  /** `KeyboardEvent.key`; a single character compares case-insensitively. */
  key: string;
  /** Ctrl (Windows/Linux) or Command (macOS). */
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface PptxShortcutBinding {
  /** Unique binding id; one action may carry a secondary chord. */
  id: string;
  action: PptxShortcutAction;
  /** The ribbon command the action runs, when one exists. */
  commandId?: PptxCommandId;
  chord: PptxShortcutChord;
  /** Full i18next key under office.pptx.shortcuts. */
  labelKey: string;
  group: PptxShortcutGroup;
  /** Listed in the help dialog; a secondary chord for the same action is not. */
  help?: boolean;
}

/** The minimal key-event shape the matcher reads; a DOM or React event satisfies it. */
export interface PptxKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const primary = (key: string, extra: Partial<PptxShortcutChord> = {}): PptxShortcutChord => ({
  key,
  primary: true,
  ...extra,
});

/**
 * Every chord the canvas answers, in help-dialog order. Undo/redo/save/find and
 * edit-text are the ribbon commands the editor already dispatches; the rest are
 * the selection and navigation keys the canvas handler owns.
 */
export const PPTX_SHORTCUTS: readonly PptxShortcutBinding[] = [
  { id: "undo", action: "undo", commandId: "undo", chord: primary("Z"), labelKey: "office.pptx.shortcuts.undo", group: "editing" },
  { id: "redo", action: "redo", commandId: "redo", chord: primary("Y"), labelKey: "office.pptx.shortcuts.redo", group: "editing" },
  { id: "redo-shift", action: "redo", commandId: "redo", chord: primary("Z", { shift: true }), labelKey: "office.pptx.shortcuts.redo", group: "editing", help: false },
  { id: "save", action: "save", commandId: "save", chord: primary("S"), labelKey: "office.pptx.shortcuts.save", group: "editing" },
  { id: "find", action: "find", commandId: "find", chord: primary("F"), labelKey: "office.pptx.shortcuts.find", group: "editing" },
  { id: "edit-text", action: "edit-text", commandId: "edit-text", chord: { key: "F2" }, labelKey: "office.pptx.shortcuts.edit_text", group: "editing" },
  { id: "select-all", action: "select-all", chord: primary("A"), labelKey: "office.pptx.shortcuts.select_all", group: "editing" },
  { id: "delete-selection", action: "delete-selection", chord: { key: "Delete" }, labelKey: "office.pptx.shortcuts.delete_selection", group: "editing" },
  { id: "delete-selection-backspace", action: "delete-selection", chord: { key: "Backspace" }, labelKey: "office.pptx.shortcuts.delete_selection", group: "editing", help: false },
  { id: "next-slide", action: "next-slide", chord: { key: "ArrowDown" }, labelKey: "office.pptx.shortcuts.next_slide", group: "navigation" },
  { id: "previous-slide", action: "previous-slide", chord: { key: "ArrowUp" }, labelKey: "office.pptx.shortcuts.previous_slide", group: "navigation" },
  { id: "next-slide-page", action: "next-slide", chord: { key: "PageDown" }, labelKey: "office.pptx.shortcuts.next_slide", group: "navigation", help: false },
  { id: "previous-slide-page", action: "previous-slide", chord: { key: "PageUp" }, labelKey: "office.pptx.shortcuts.previous_slide", group: "navigation", help: false },
  { id: "dismiss", action: "dismiss", chord: { key: "Escape" }, labelKey: "office.pptx.shortcuts.dismiss", group: "navigation" },
  { id: "shortcuts-help", action: "shortcuts-help", chord: { key: "?", shift: true }, labelKey: "office.pptx.shortcuts.help", group: "view" },
  { id: "shortcuts-help-f1", action: "shortcuts-help", chord: { key: "F1" }, labelKey: "office.pptx.shortcuts.help", group: "view", help: false },
];

/** Help-dialog group order, with the i18next key of each heading. */
export const PPTX_SHORTCUT_GROUPS: readonly { id: PptxShortcutGroup; labelKey: string }[] = [
  { id: "editing", labelKey: "office.pptx.shortcuts.group_editing" },
  { id: "view", labelKey: "office.pptx.shortcuts.group_view" },
  { id: "navigation", labelKey: "office.pptx.shortcuts.group_navigation" },
];

/** A single character compares case-insensitively (`Ctrl+Z` reports "z"). */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function flag(value: boolean | undefined): boolean {
  return value === true;
}

/** Whether an event is this binding's chord. Modifiers must match exactly. */
export function pptxShortcutMatches(binding: PptxShortcutBinding, event: PptxKeyEventLike): boolean {
  const chord = binding.chord;
  if (normalizeKey(event.key) !== normalizeKey(chord.key)) return false;
  if (flag(chord.primary) !== (flag(event.ctrlKey) || flag(event.metaKey))) return false;
  if (flag(chord.shift) !== flag(event.shiftKey)) return false;
  if (flag(chord.alt) !== flag(event.altKey)) return false;
  return true;
}

/** The first binding an event satisfies, or null. Order is the table's order. */
export function matchPptxShortcut(event: PptxKeyEventLike): PptxShortcutBinding | null {
  return PPTX_SHORTCUTS.find((binding) => pptxShortcutMatches(binding, event)) ?? null;
}

/** The primary binding of an action (the one the help dialog lists). */
export function pptxShortcutForAction(action: PptxShortcutAction): PptxShortcutBinding | undefined {
  return PPTX_SHORTCUTS.find((binding) => binding.action === action && binding.help !== false);
}

/** Bindings the help dialog shows, in table order. */
export function pptxShortcutsForHelp(): readonly PptxShortcutBinding[] {
  return PPTX_SHORTCUTS.filter((binding) => binding.help !== false);
}

/** Keycap labels for one chord, e.g. ["Ctrl", "Shift", "Z"] or ["Cmd", "Z"]. */
export function pptxShortcutKeys(binding: PptxShortcutBinding, platform: string = "windows"): string[] {
  const mac = platform === "macos";
  const keys: string[] = [];
  if (binding.chord.primary) keys.push(mac ? "Cmd" : "Ctrl");
  if (binding.chord.shift) keys.push(mac ? "Shift" : "Shift");
  if (binding.chord.alt) keys.push(mac ? "Opt" : "Alt");
  keys.push(binding.chord.key);
  return keys;
}

/** A key that types a character (no Ctrl/Cmd/Alt chord): over a selected text element
 *  it starts editing that element (UNI-958). Checked only after the chords above. */
export function isPptxTypedKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return event.key.length === 1 && event.ctrlKey !== true && event.metaKey !== true && event.altKey !== true;
}
