import {
  shortcutMatchesEvent,
  type ShortcutChord,
  type ShortcutPlatform,
} from "@uniwork/core/shortcuts";

/**
 * The key a physical position produces when the chord declares the unshifted
 * spelling. `KeyboardEvent.key` reports the character the layout produces —
 * Ctrl+Shift+8 delivers "*" on a US keyboard, never "8" — so a digit or
 * punctuation chord only matches a real keydown through `event.code`.
 */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Period: ".",
  Comma: ",",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
};

/** US-layout shifted glyphs for those same keys, so a synthetic keydown that
 * carries no `event.code` still resolves the chord the help sheet shows. */
const SHIFTED_GLYPHS: Readonly<Record<string, string>> = {
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  ">": ".",
  "<": ",",
  "?": "/",
  ":": ";",
  '"': "'",
  "~": "`",
  "{": "[",
  "}": "]",
  "|": "\\",
  "_": "-",
  "+": "=",
};

/** The same keydown with the logical key substituted; modifiers are untouched. */
function eventWithKey(event: KeyboardEvent, key: string): KeyboardEvent {
  return {
    key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    getModifierState: (state: string) => event.getModifierState?.(state) ?? false,
  } as KeyboardEvent;
}

/**
 * The DOCX resolver's chord match: the core exact match first, then the keys
 * the event's physical code or shifted glyph stand for. The fallback keeps a
 * declared digit/punctuation chord reachable on every layout — the layer the
 * core matcher deliberately leaves to its consumers.
 */
export function docxShortcutMatchesEvent(
  chord: ShortcutChord,
  event: KeyboardEvent,
  platform: ShortcutPlatform,
): boolean {
  if (shortcutMatchesEvent(chord, event, platform)) return true;
  for (const candidate of [CODE_KEYS[event.code], SHIFTED_GLYPHS[event.key]]) {
    if (!candidate || candidate === event.key) continue;
    if (shortcutMatchesEvent(chord, eventWithKey(event, candidate), platform)) return true;
  }
  return false;
}
