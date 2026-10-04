/**
 * The command row's overflow decision (brief C7/C12).
 *
 * The row is ONE line: when the groups no longer fit, WHOLE groups move into
 * the trailing "»" menu, never a ragged second row. The rule has two steps:
 *
 * 1. If every group fits by itself, nothing overflows and the "»" control is
 *    not rendered at all - the row never pays for a menu that would be empty.
 * 2. Otherwise the "»" keeps its own room, and the groups that still fit stay
 *    in the row; the rest move into the menu in the same order.
 *
 * Pure on purpose: the component measures, this decides, and the decision is
 * unit-tested without a DOM.
 */
export interface OverflowInput {
  /** Rendered width of each group, in DOM order. */
  groupWidths: readonly number[];
  /** Width available to the command row, after the row's own padding. */
  containerWidth: number;
  /** Width of the trailing "»" control itself, separator excluded. */
  overflowButtonWidth: number;
  /** Width of one group separator. Defaults to 0. */
  separatorWidth?: number;
}

/** How many leading groups fit into `budget`, counting separators between them. */
function countFitting(widths: readonly number[], budget: number, separatorWidth: number): number {
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index] ?? 0;
    const nextUsed = index === 0 ? width : used + separatorWidth + width;
    if (nextUsed > budget) return index;
    used = nextUsed;
  }
  return widths.length;
}

/**
 * How many leading groups stay in the row. Equals `groupWidths.length` when
 * every group fits (then no "»" is rendered); otherwise it is the number that
 * fits alongside the "»", so at least one group is always in the menu.
 *
 * A container width of 0 means "not measured yet" - every group stays, and the
 * first layout pass corrects the row instead of hiding it for a frame.
 */
export function fittingGroupCount({
  groupWidths,
  containerWidth,
  overflowButtonWidth,
  separatorWidth = 0,
}: OverflowInput): number {
  const count = groupWidths.length;
  if (count === 0) return 0;
  if (containerWidth <= 0) return count;
  const withoutOverflow = countFitting(groupWidths, containerWidth, separatorWidth);
  if (withoutOverflow >= count) return count;
  // A zero (or negative) budget means the component does not reserve room for
  // "»" at all - it only renders the menu when a group is hidden, so a hidden
  // group must imply the room. Spending the row's own gap on the control would
  // then hand the menu a group the row still keeps, and the row would clip it.
  if (overflowButtonWidth <= 0) return count;
  // `countFitting` already counts the gap between the last visible group and
  // "»" as a separator, so the control's own width is all that is subtracted.
  return countFitting(groupWidths, containerWidth - overflowButtonWidth, separatorWidth);
}

/** Indexes of the groups that stay in the row, in order. */
export function visibleGroupIndexes(input: OverflowInput): number[] {
  const fitting = fittingGroupCount(input);
  return Array.from({ length: fitting }, (_, index) => index);
}

/** Indexes of the groups that move into the "»" menu, in the same order. */
export function hiddenGroupIndexes(input: OverflowInput): number[] {
  return input.groupWidths.map((_, index) => index).slice(fittingGroupCount(input));
}
