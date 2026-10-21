import type { ShortcutChord } from "./definitions";
import { getShortcutPlatform, type ShortcutPlatform } from "./platform";

// ARIA key names (UI Events `key` values) for the chord keys that differ.
const ARIA_KEYS: Record<string, string> = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Plus: "+",
  Minus: "-",
  Equals: "=",
  Space: " ",
};

/**
 * `aria-keyshortcuts` value for a chord, in ARIA syntax for the platform:
 * `primary` is Meta on macOS and Control elsewhere. A button's accessible name
 * stays the plain command; this carries the chord. A cleared chord yields
 * undefined so the attribute is omitted.
 */
export function ariaKeyShortcuts(
  chord: ShortcutChord | null,
  platform: ShortcutPlatform = getShortcutPlatform(),
): string | undefined {
  if (!chord) return undefined;
  const { modifiers } = chord;
  const parts = [
    modifiers.primary ? (platform === "macos" ? "Meta" : "Control") : null,
    modifiers.control ? "Control" : null,
    modifiers.meta ? "Meta" : null,
    modifiers.alt ? "Alt" : null,
    modifiers.shift ? "Shift" : null,
    ARIA_KEYS[chord.key] ?? chord.key,
  ];
  return parts.filter(Boolean).join("+");
}
