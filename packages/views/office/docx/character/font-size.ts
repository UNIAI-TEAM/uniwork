/** Word's preset size list, ported from the genoffice ribbon (A+/A− walks it). */
export const FONT_SIZES: readonly number[] = [
  5, 5.5, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
];

/** Word's default body size; used when the caret carries no explicit size
 * (the parsed docDefaults/styles are not reachable from the toolbar context). */
export const DEFAULT_FONT_SIZE_PT = 11;

/** The next preset in the A+/A− walk; a size between presets lands on the
 * nearest preset in the pressed direction, exactly like Word's boxes. */
export function nextFontSize(current: number, direction: 1 | -1): number {
  const index = FONT_SIZES.findIndex((size) => size >= current);
  if (direction === 1) {
    const next = index === -1 ? FONT_SIZES.length : index + (FONT_SIZES[index] === current ? 1 : 0);
    return FONT_SIZES[Math.min(next, FONT_SIZES.length - 1)] as number;
  }
  return FONT_SIZES[Math.max(index === -1 ? FONT_SIZES.length - 1 : index - 1, 0)] as number;
}
