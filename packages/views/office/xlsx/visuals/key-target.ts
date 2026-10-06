// UNI-953 review r3 F1/F2: whose key a press is. The grid's focus target is
// Univer's own contenteditable editor input, focused whether or not a cell is
// being edited, so "contenteditable" alone does not mean typing: the renderer's
// cell-edit state decides it there.

/** The renderer's cell-edit state; null when it cannot tell. */
export type XlsxCellEditingProbe = () => boolean | null;

const FORM_CONTROL = "input, textarea, select";
const EDITABLE = "[contenteditable]:not([contenteditable=\"false\"])";
/** Univer's editor input, and anything editable inside the grid surface. */
const GRID_EDITOR = "[data-u-comp=\"editor\"], [data-xlsx-grid-surface]";
const OTHER_TEXT = "[role=\"dialog\"], [role=\"textbox\"]";

/** True when the key belongs to text being typed (a form control, a dialog,
 *  an open cell edit), so Undo/Delete of a visual must leave it alone. In the
 *  grid's editor without a cell-edit probe, a selected visual means no cell is
 *  being edited (a press in a cell clears the selection). */
export function keyTypesText(target: EventTarget | null, isCellEditing: XlsxCellEditingProbe | undefined, visualSelected: boolean): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(FORM_CONTROL)) return true;
  const editable = target.closest(EDITABLE);
  if (editable?.closest(GRID_EDITOR)) {
    const editing = isCellEditing?.() ?? null;
    return editing === null ? !visualSelected : editing;
  }
  return editable !== null || target.closest(OTHER_TEXT) !== null;
}
