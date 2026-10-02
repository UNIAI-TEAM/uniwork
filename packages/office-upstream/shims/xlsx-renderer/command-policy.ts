import type { IRange } from "@univerjs/core";
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { CELL_MUTATIONS, type RendererCommand } from "./edits";

const VIEW_COMMANDS = new Set([
  "univer.command.copy", "doc.operation.set-selections", "doc.operation.move-cursor",
  "doc.operation.move-selection", "doc.command.select-all",
  "sheet.operation.set-worksheet-active", "sheet.command.set-worksheet-activate",
  "sheet.operation.set-selections", "sheet.operation.set-scroll", "sheet.operation.scroll-to-cell",
  "sheet.operation.scroll-to-range", "sheet.operation.set-zoom-ratio",
  "sheet.operation.mark-dirty-row-auto-height", "sheet.operation.cancel-mark-dirty-row-auto-height",
  "sheet.command.select-range", "sheet.command.move-selection", "sheet.command.move-selection-enter-tab",
  "sheet.command.expand-selection", "sheet.command.select-all", "sheet.command.set-scroll-relative",
  "sheet.command.scroll-view", "sheet.command.scroll-to-cell", "sheet.command.scroll-view-reset",
  "sheet.command.change-zoom-ratio", "sheet.command.set-zoom-ratio",
]);

const EDIT_COMMANDS = new Set([
  "univer.command.undo", "univer.command.redo",
  "sheet.command.set-range-values", "sheet.command.clear-selection-content",
  "sheet.command.clear-selection-all", "sheet.command.clear-selection-format",
  "sheet.command.set-style", "sheet.command.set-bold", "sheet.command.set-italic",
  "sheet.command.set-underline", "sheet.command.set-stroke", "sheet.command.set-font-family",
  "sheet.command.set-font-size", "sheet.command.set-text-color", "sheet.command.reset-text-color",
  "sheet.command.set-background-color", "sheet.command.reset-background-color",
  "sheet.command.set-vertical-text-align", "sheet.command.set-horizontal-text-align",
  "sheet.command.set-text-wrap", "sheet.command.set-text-rotation",
  "sheet.command.set-border", "sheet.command.set-border-position", "sheet.command.set-border-style",
  "sheet.command.set-border-color", "sheet.command.set-border-basic",
  "sheet.command.set-range-bold", "sheet.command.set-range-italic", "sheet.command.set-range-underline",
  "sheet.command.set-range-stroke", "sheet.command.set-range-fontsize",
  "sheet.command.set-range-font-increase", "sheet.command.set-range-font-decrease",
  "sheet.command.set-range-font-family", "sheet.command.set-range-text-color", "sheet.command.reset-range-text-color",
  "sheet.command.numfmt.set.numfmt", "sheet.command.numfmt.add.decimal.command",
  "sheet.command.numfmt.subtract.decimal.command", "sheet.command.numfmt.set.currency", "sheet.command.numfmt.set.percent",
  "sheet.operation.set-activate-cell-edit", "sheet.operation.set-cell-edit-visible",
  "sheet.operation.set-cell-edit-visible-f2", "sheet.operation.set-cell-edit-visible-arrow",
  "doc.command.insert-text", "doc.command.ime-input", "doc.command.update-text",
  "doc.command.delete-text", "doc.command.delete-left", "doc.command.delete-right",
  "doc.command.break-line", "doc.command.enter", "doc.command.tab", "doc.command.after-space",
  "doc.command.merge-two-paragraph", "doc.command.delete-current-paragraph",
  "doc.command.replace-selection", "doc.command-replace-content", "doc.command-replace-snapshot",
  "doc.command.inner-paste", "doc.mutation.rich-text-editing",
]);

function validRange(range: IRange): boolean {
  return [range.startRow, range.endRow, range.startColumn, range.endColumn].every(
    (value) => Number.isInteger(value) && value >= 0,
  ) && range.startRow <= range.endRow && range.startColumn <= range.endColumn &&
    range.endRow < 1_048_576 && range.endColumn < 16_384 &&
    (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) <= 100_000;
}

/** Original content must be installed before an undoable user edit. */
export function canEditRange(state: LazyWorkbookState | null, sheetId: string, range: IRange): boolean {
  const sheet = state?.file.sheets.find((candidate) => candidate.id === sheetId);
  if (!state || !sheet || !validRange(range)) return false;
  if (sheet.pivotRanges?.some((pivot) => range.startRow <= pivot.endRow && range.endRow >= pivot.startRow &&
    range.startColumn <= pivot.endColumn && range.endColumn >= pivot.startColumn)) return false;
  if (state.flags.preloadComplete) return true;
  // Intersect with the file's data extent: cells outside it are truly empty.
  const endRow = Math.min(range.endRow, sheet.rowCount - 1);
  const endColumn = Math.min(range.endColumn, sheet.columnCount - 1);
  if (range.startRow > endRow || range.startColumn > endColumn) return true;
  const loaded = state.loadedRanges.get(sheetId);
  return !!loaded && range.startRow >= loaded.startRow && endRow <= loaded.endRow &&
    range.startColumn >= loaded.startColumn && endColumn <= loaded.endColumn;
}

const CELL_FIELDS = new Set(["v", "t", "f", "si", "p", "s"]);
const CLEAR_ONLY_FIELDS = new Set(["custom", "ref", "xf"]);
const AUTO_HEIGHT_TRIGGERS = new Set([
  "sheet.command.set-range-values", "sheet.command.set-style",
  "sheet.command.clear-selection-all", "sheet.command.clear-selection-format", "sheet.command.clear-selection-content",
  "univer.command.undo", "univer.command.redo", "sheet.command.paste-by-short-key",
]);
const FORMULA_MUTATIONS = new Set([
  "register-function", "set-array-formula-data", "set-defined-name", "remove-defined-name",
  "set-feature-calculation", "remove-feature-calculation", "set-formula-calculation-start",
  "set-trigger-formula-calculation-start", "set-formula-string-batch-calculation",
  "set-formula-string-batch-calculation-result", "set-formula-calculation-stop",
  "set-formula-calculation-notification", "set-formula-calculation-result",
  "set-formula-dependency-calculation", "set-formula-dependency-calculation-result",
  "set-cell-formula-dependency-calculation", "set-cell-formula-dependency-calculation-result",
  "set-query-formula-dependency", "set-query-formula-dependency-result",
  "set-query-formula-dependency-all", "set-query-formula-dependency-all-result",
  "set-formula-data", "set-image-formula-data", "set-other-formula", "remove-other-formula",
  "set-super-table", "remove-super-table", "set-super-table-option",
].map((id) => `formula.mutation.${id}`));

function canRestoreRange(state: LazyWorkbookState, sheetId: string, range: IRange): boolean {
  if (!validRange(range)) return false;
  const entries = state.editJournal.cells.get(sheetId);
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let column = range.startColumn; column <= range.endColumn; column++) {
      if (!entries?.has(`${row}:${column}`)) return false;
    }
  }
  return true;
}

/** Default deny keeps unsavable changes out of both commands and shortcuts. */
export function canExecuteCommand(
  event: RendererCommand,
  state: LazyWorkbookState | null,
  readOnly: boolean,
): boolean {
  if (VIEW_COMMANDS.has(event.id)) return true;
  // Engine bookkeeping is derived state; no user-facing formula commands.
  if (FORMULA_MUTATIONS.has(event.id)) return true;
  if (event.options?.fromFormula && event.id === "sheet.mutation.set-range-values") return true;
  if (readOnly || !state) return false;
  if (event.id === "sheet.command.paste-by-short-key") {
    const params = event.params as { htmlContent?: string; textContent?: string; files?: unknown[] } | undefined;
    return !!params && !params.htmlContent && !params.files?.length && typeof params.textContent === "string";
  }
  // Univer's generic paste reads the rich clipboard asynchronously, after
  // its cancellable event has returned. Native plain-text paste above is the
  // supported path; refusing generic paste avoids partially applied objects.
  if (event.id === "sheet.mutation.set-worksheet-row-auto-height") {
    const params = event.params as { trigger?: string; unitId?: string; subUnitId?: string } | undefined;
    // Cell layout generates ah (derived display height), not authored ht.
    // Refusing it after the value write aborts the parent command's undo push.
    return !!params && params.unitId === `file-${state.file.sha256}` &&
      state.file.sheets.some((sheet) => sheet.id === params.subUnitId) && AUTO_HEIGHT_TRIGGERS.has(params.trigger ?? "");
  }
  if (!CELL_MUTATIONS.has(event.id)) return EDIT_COMMANDS.has(event.id);
  const params = event.params as {
    unitId?: string; subUnitId?: string; cellValue?: unknown;
    ranges?: IRange[]; values?: Record<string, { ranges?: IRange[] }>; trigger?: string;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId) return false;
  const restoring = params.trigger === "univer.command.undo" || params.trigger === "univer.command.redo";
  const safeRange = (range: IRange) => canEditRange(state, sheetId, range) ||
    (restoring && canRestoreRange(state, sheetId, range));
  if (event.id !== "sheet.mutation.set-range-values") {
    const ranges = params.ranges ?? Object.values(params.values ?? {}).flatMap((group) => group.ranges ?? []);
    return ranges.every(safeRange);
  }
  if (!params.cellValue || typeof params.cellValue !== "object") return false;
  for (const [row, columns] of Object.entries(params.cellValue)) {
    if (!columns || typeof columns !== "object") return false;
    for (const [column, cell] of Object.entries(columns)) {
      if (cell && (typeof cell !== "object" || Object.entries(cell).some(([key, value]) =>
        !CELL_FIELDS.has(key) && !(value === null && CLEAR_ONLY_FIELDS.has(key))))) return false;
      if (!safeRange({
        startRow: Number(row), endRow: Number(row), startColumn: Number(column), endColumn: Number(column),
      })) return false;
    }
  }
  return true;
}
