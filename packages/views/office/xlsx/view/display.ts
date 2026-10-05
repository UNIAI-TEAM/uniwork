/** View-state-only display toggles: gridlines and the row/column headers.
 *  Both ride allowlisted view commands and never touch the edit journal or the
 *  save path. The pinned renderer exposes no header-visibility command, so the
 *  headers toggle resizes the two header strips to zero and back to the
 *  renderer's defaults. */

export const XLSX_GRIDLINES_COMMAND = "sheet.command.toggle-gridlines";
export const XLSX_ROW_HEADER_WIDTH_COMMAND = "sheet.command.set-row-header-width";
export const XLSX_COLUMN_HEADER_HEIGHT_COMMAND = "sheet.command.set-col-header-height";

/** The pin's default header sizes (DEFAULT_ROW_HEADER_WIDTH / _COLUMN_HEADER_HEIGHT). */
export const XLSX_ROW_HEADER_WIDTH = 46;
export const XLSX_COLUMN_HEADER_HEIGHT = 20;

const BOOLEAN_TRUE = 1;
const BOOLEAN_FALSE = 0;

/** `sheet.command.toggle-gridlines` flips the sheet's gridlines when the
 *  requested value differs and no-ops when the sheet already matches it. */
export function gridlinesCommandParams(visible: boolean): { showGridlines: number } {
  return { showGridlines: visible ? BOOLEAN_TRUE : BOOLEAN_FALSE };
}

export interface XlsxHeaderSizeCommand {
  readonly id: string;
  readonly params: { readonly size: number };
}

export function headerSizeCommands(visible: boolean): readonly XlsxHeaderSizeCommand[] {
  return [
    { id: XLSX_ROW_HEADER_WIDTH_COMMAND, params: { size: visible ? XLSX_ROW_HEADER_WIDTH : 0 } },
    { id: XLSX_COLUMN_HEADER_HEIGHT_COMMAND, params: { size: visible ? XLSX_COLUMN_HEADER_HEIGHT : 0 } },
  ];
}
