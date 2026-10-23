/**
 * Elements inside a table row whose clicks belong to a control, not to the
 * row. The row-open handler in table-view.tsx skips a click or middle-click
 * whose target sits inside one of these.
 *
 * `[role^='menuitem']` covers `menuitem`, `menuitemradio` and
 * `menuitemcheckbox`; `[role='option']` covers combobox/listbox items. Menu
 * and combobox popups are portalled out of the row's DOM, but React still
 * bubbles their events through the row, so the target is the item itself.
 *
 * This is one layer, not the only one: every picker also stops its own
 * events (`onTriggerNavigationGuard`, `RowEventBoundary`). Keep both.
 */
export const ROW_CONTROL_SELECTOR =
  "button, input, a, [role^='menuitem'], [role='option']";

/** True when an event on `target` belongs to a control inside the row. */
export function isRowControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ROW_CONTROL_SELECTOR) !== null;
}
