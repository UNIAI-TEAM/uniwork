/**
 * Text size — the accessibility setting in Settings → Preferences.
 *
 * Only the NAME of a level crosses into JavaScript. The multiplier each level
 * means lives in `styles/tokens.css` (`--font-scale` under `[data-text-size]`),
 * so the scale has one source and the boot script below carries no numbers.
 * Kept on this device, like the accent and light/dark.
 */

/** Insertion order is the order of the picker. */
export const TEXT_SIZES = ["default", "large", "xlarge"] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

/** The level `:root` already holds; it needs no attribute. */
export const DEFAULT_TEXT_SIZE: TextSize = "default";

export const TEXT_SIZE_STORAGE_KEY = "uniwork-text-size";

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZES as readonly string[]).includes(value);
}

export function applyTextSize(size: TextSize, root: HTMLElement): void {
  if (size === DEFAULT_TEXT_SIZE) root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", size);
}

export function readStoredTextSize(): TextSize {
  try {
    const stored = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    return isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
  } catch {
    // Private mode / blocked storage: the default size is a fine answer.
    return DEFAULT_TEXT_SIZE;
  }
}

/**
 * Runs before first paint from a blocking inline <script>, like
 * `accentBootScript`: without it the page paints one frame at 14px and then
 * jumps. Only the non-default names are accepted, so a stale or hand-edited
 * value leaves the default in place.
 */
export function textSizeBootScript(): string {
  const levels = TEXT_SIZES.filter((size) => size !== DEFAULT_TEXT_SIZE);
  return `(function(){try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(${JSON.stringify(levels)}.indexOf(s)<0)return;document.documentElement.setAttribute("data-text-size",s);}catch(_){}})()`;
}
