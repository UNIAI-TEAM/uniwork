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
  // Format painter: the toolbar arms/cancels the one-shot mode through the
  // synchronous `set-format-painter` operation; the sheets-ui render controller
  // applies the captured format on the next selection end with
  // `apply-format-painter` and toggles the mode off with
  // `set-once-format-painter`. The style writes ride the allowlisted
  // `sheet.mutation.set-range-values` path; the merge mutations the painter
  // would also emit stay refused (no merge op exists to save them).
  // Retained: A3's clear + format painter (shipped at ec8ac4bc) drives these ids.
  "sheet.operation.set-format-painter", "sheet.command.apply-format-painter",
  "sheet.command.set-once-format-painter",
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

// ── row/column structure (B1) ──────────────────────────────────────────────
//
// Exactly the commands the structure toolbar (and the mutations those
// commands dispatch) rides. Nothing else structural passes: the journal only
// knows the ten op kinds the save can replay.

const STRUCTURAL_COMMANDS = new Set([
  "sheet.command.insert-row-before",
  "sheet.command.insert-row-after",
  "sheet.command.insert-col-before",
  "sheet.command.insert-col-after",
  "sheet.command.remove-row",
  "sheet.command.remove-col",
  "sheet.command.set-row-height",
  "sheet.command.set-worksheet-col-width",
  "sheet.command.set-row-is-auto-height",
  "sheet.command.set-rows-hidden",
  "sheet.command.set-col-hidden",
  "sheet.command.set-selected-rows-visible",
  "sheet.command.set-selected-cols-visible",
  "sheet.command.set-specific-rows-visible",
  "sheet.command.set-col-visible-on-cols",
  // UniWork outline commands: the pinned Univer has no outline model, so the
  // controller registers these and journals their level edits directly. The
  // dead pinned `set-col-is-auto-width` (no mutation in this build) is not
  // allowlisted; the default-width reset journals through the UniWork
  // command instead.
  "uniwork.command.set-rows-outline",
  "uniwork.command.set-cols-outline",
  "uniwork.command.set-cols-default-width",
]);

interface StructuralMutationShape {
  readonly axis: "row" | "column";
  readonly kind: "shift" | "size" | "hidden" | "auto-size";
}

const STRUCTURAL_MUTATIONS: Record<string, StructuralMutationShape> = {
  "sheet.mutation.insert-row": { axis: "row", kind: "shift" },
  "sheet.mutation.remove-rows": { axis: "row", kind: "shift" },
  "sheet.mutation.insert-col": { axis: "column", kind: "shift" },
  "sheet.mutation.remove-col": { axis: "column", kind: "shift" },
  "sheet.mutation.set-worksheet-row-height": { axis: "row", kind: "size" },
  "sheet.mutation.set-worksheet-col-width": { axis: "column", kind: "size" },
  "sheet.mutation.set-worksheet-row-is-auto-height": { axis: "row", kind: "auto-size" },
  "sheet.mutation.set-row-hidden": { axis: "row", kind: "hidden" },
  "sheet.mutation.set-row-visible": { axis: "row", kind: "hidden" },
  "sheet.mutation.set-col-hidden": { axis: "column", kind: "hidden" },
  "sheet.mutation.set-col-visible": { axis: "column", kind: "hidden" },
};

/** One axis span inside the grid and under the wire's span ceiling. */
function structuralSpanOK(range: unknown, axis: "row" | "column"): boolean {
  if (!range || typeof range !== "object") return false;
  const span = range as Record<string, unknown>;
  const start = axis === "row" ? span.startRow : span.startColumn;
  const end = axis === "row" ? span.endRow : span.endColumn;
  const limit = axis === "row" ? 1_048_576 : 16_384;
  return typeof start === "number" && typeof end === "number" && Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && end >= start && end < limit && end - start < 100_000;
}

/** Univer's size mutations measure pixels; the wire bound keeps pathological
 *  values out (Excel's own maxima are far below 4096px). */
function sizeValueOK(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 && value <= 4096;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.values(value);
    return entries.length > 0 && entries.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0 && entry <= 4096);
  }
  return false;
}

function autoSizeInfoOK(value: unknown): boolean {
  if (typeof value === "number") return value === 0 || value === 1;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.values(value);
    return entries.length > 0 && entries.every((entry) => entry === 0 || entry === 1);
  }
  return false;
}

function structuralMutationAllowed(
  event: RendererCommand,
  state: LazyWorkbookState,
): boolean {
  const shape = STRUCTURAL_MUTATIONS[event.id];
  if (!shape) return false;
  const params = event.params as {
    unitId?: string; subUnitId?: string; range?: unknown; ranges?: unknown;
    rowHeight?: unknown; colWidth?: unknown; autoHeightInfo?: unknown;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
    !state.file.sheets.some((sheet) => sheet.id === sheetId)) return false;
  if (shape.kind === "shift") return structuralSpanOK(params.range, shape.axis);
  if (!Array.isArray(params.ranges) || params.ranges.length === 0 ||
    !params.ranges.every((range) => structuralSpanOK(range, shape.axis))) return false;
  if (shape.kind === "hidden") return true;
  if (shape.kind === "auto-size") return autoSizeInfoOK(params.autoHeightInfo);
  return sizeValueOK(shape.axis === "row" ? params.rowHeight : params.colWidth);
}

/** A UniWork axis-span command: an in-grid span on its axis and an optional
 *  known subUnitId. */
function structuralAxisCommandOK(
  params: { start?: unknown; end?: unknown; subUnitId?: unknown } | undefined,
  axis: "row" | "column",
  state: LazyWorkbookState,
): boolean {
  if (!params) return false;
  return structuralSpanOK({ startRow: params.start, endRow: params.end, startColumn: params.start, endColumn: params.end }, axis) &&
    (params.subUnitId === undefined || (typeof params.subUnitId === "string" && state.file.sheets.some((sheet) => sheet.id === params.subUnitId)));
}

function structuralCommandAllowed(
  event: RendererCommand,
  state: LazyWorkbookState,
): boolean {
  const params = event.params as {
    value?: unknown; range?: unknown; ranges?: unknown; start?: unknown; end?: unknown; action?: unknown; subUnitId?: unknown;
  } | undefined;
  if (event.id === "uniwork.command.set-rows-outline" || event.id === "uniwork.command.set-cols-outline") {
    return (params?.action === "group" || params?.action === "ungroup" || params?.action === "clear") &&
      structuralAxisCommandOK(params, event.id.includes("rows") ? "row" : "column", state);
  }
  if (event.id === "uniwork.command.set-cols-default-width") {
    return structuralAxisCommandOK(params, "column", state);
  }
  if (event.id === "sheet.command.insert-row-before" || event.id === "sheet.command.insert-col-before") {
    const value = params?.value;
    return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10_000);
  }
  if (event.id === "sheet.command.set-row-height" || event.id === "sheet.command.set-worksheet-col-width") {
    return typeof params?.value === "number" && Number.isFinite(params.value) && params.value > 0 && params.value <= 4096;
  }
  if (event.id === "sheet.command.set-row-is-auto-height") {
    if (params?.ranges === undefined) return true;
    return Array.isArray(params.ranges) && params.ranges.every((range) => structuralSpanOK(range, "row"));
  }
  if (event.id === "sheet.command.set-rows-hidden" || event.id === "sheet.command.set-col-hidden") {
    const axis = event.id.includes("rows") ? "row" : "column";
    if (params?.ranges === undefined) return true;
    return Array.isArray(params.ranges) && params.ranges.length > 0 && params.ranges.every((range) => structuralSpanOK(range, axis));
  }
  // Remove row/col and the reveal commands: selection-driven, an explicit
  // range/ranges is optional and bounded when present.
  const axis = event.id.includes("col") ? "column" : "row";
  if (params?.range !== undefined && !structuralSpanOK(params.range, axis)) return false;
  if (params?.ranges !== undefined) {
    if (!Array.isArray(params.ranges) || params.ranges.length === 0 ||
      !params.ranges.every((range) => structuralSpanOK(range, axis))) return false;
  }
  return true;
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

function canMarkConditionalFormulaDirty(event: RendererCommand, state: LazyWorkbookState | null): boolean {
  if (!state || event.type !== 2 || !event.options?.onlyLocal || !event.params || typeof event.params !== "object") return false;
  const units = Object.entries(event.params);
  const unitId = `file-${state.file.sha256}`;
  if (units.length !== 1 || units[0]![0] !== unitId) return false;
  const sheets = units[0]![1];
  if (!sheets || typeof sheets !== "object") return false;
  const entries = Object.entries(sheets);
  return entries.length > 0 && entries.every(([sheetId, formulas]) => {
    if (!state.file.sheets.some((sheet) => sheet.id === sheetId) || !formulas || typeof formulas !== "object") return false;
    const dirty = Object.entries(formulas);
    return dirty.length > 0 && dirty.every(([id, value]) =>
      id.startsWith(`formula.${unitId}_${sheetId}_cf_`) && value === true);
  });
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
  // Despite its pinned name, this no-op mutation schedules all "other"
  // formulas, including CF. It carries only bound dirty flags, never cells.
  if (event.id === "sheet.mutation.data-validation-formula-mark-dirty") return canMarkConditionalFormulaDirty(event, state);
  if (event.options?.fromFormula && event.id === "sheet.mutation.set-range-values") return true;
  if (readOnly || !state) return false;
  // Pinned docs-ui registers a four-character-suffixed operation for the
  // normal in-cell editor's Enter/Tab/Escape handler. It closes the editor;
  // the subsequent cell mutation still passes the loaded-range/write gate.
  if (/^sheet\.operation\.editor-__INTERNAL_EDITOR__DOCS_NORMAL-keyboard-[A-Za-z0-9_-]{4}$/.test(event.id)) {
    const params = event.params as { keyCode?: number; metaKey?: number } | undefined;
    return event.type === 1 && !!params && [9, 13, 27].includes(params.keyCode ?? -1) &&
      (params.metaKey === undefined || params.metaKey === 0);
  }
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
  if (!CELL_MUTATIONS.has(event.id)) {
    if (STRUCTURAL_COMMANDS.has(event.id)) return structuralCommandAllowed(event, state);
    if (STRUCTURAL_MUTATIONS[event.id]) return structuralMutationAllowed(event, state);
    return EDIT_COMMANDS.has(event.id);
  }
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
