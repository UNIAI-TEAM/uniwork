/** How many leading groups fit in `available` px before the rest must collapse
 *  into the overflow panel. `widths` already carries the inter-group gap, and
 *  `overflowWidth` is the reserved trigger width when anything collapses.
 *  `0` means the whole strip collapses (the trigger stays reachable). */
export function selectVisibleGroupCount(
  widths: readonly number[],
  available: number,
  overflowWidth: number,
): number {
  if (widths.length === 0) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return widths.length;
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index] ?? 0;
    if (used + width + overflowWidth > available) return index;
    used += width;
  }
  return widths.length;
}
