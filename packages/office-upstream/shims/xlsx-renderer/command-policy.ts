import type { IRange } from "@univerjs/core";
import { FILTER_MUTATIONS } from "../../upstream/apps/sheets/src/renderer/app-constants";
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import {
  CELL_MUTATIONS,
  isSheetMutation,
  liveSessionSheets,
  sheetNameShapeOK,
  type RendererCommand,
} from "./edits";

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
  // View tab (A5): display toggles. Gridlines flips the sheet's own render
  // flag; the pinned build has no header-visibility command, so the header
  // toggle resizes the two header strips (0 hides, the renderer defaults
  // restore). All three only move render/view state - nothing to journal.
  "sheet.command.toggle-gridlines",
  "sheet.command.set-row-header-width", "sheet.command.set-col-header-height",
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
    !liveSheetIds(state).has(sheetId)) return false;
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
    (params.subUnitId === undefined || (typeof params.subUnitId === "string" && liveSheetIds(state).has(params.subUnitId)));
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

// ── merges (B2) ────────────────────────────────────────────────────────────
//
// Exactly the pinned Univer merge commands the toolbar wires, plus the shared
// base command the two family commands dispatch and the two mutations that
// change the merge model. `add-worksheet-merge-vertical` (one merge per
// column) is not a bound behaviour and stays refused; default deny remains.

const MERGE_COMMANDS = new Set([
  "sheet.command.add-worksheet-merge-all",
  "sheet.command.add-worksheet-merge-horizontal",
  "sheet.command.remove-worksheet-merge",
  // The family commands above dispatch the shared base command with the
  // expanded selections; it must pass the same gate or the merge never runs.
  "sheet.command.add-worksheet-merge",
]);

const MERGE_MUTATIONS = new Set([
  "sheet.mutation.add-worksheet-merge",
  "sheet.mutation.remove-worksheet-merge",
]);

/** One merge rectangle: integers, ordered, inside the grid, under the span
 *  ceiling and at least two cells — the ops.ts parseMergeArea bounds. */
function mergeRangeOK(range: unknown): boolean {
  if (!range || typeof range !== "object") return false;
  const area = range as Record<string, unknown>;
  if (![area.startRow, area.endRow, area.startColumn, area.endColumn].every(
    (value) => typeof value === "number" && Number.isInteger(value) && value >= 0)) return false;
  const { startRow, endRow, startColumn, endColumn } =
    area as { startRow: number; endRow: number; startColumn: number; endColumn: number };
  if (startRow > endRow || startColumn > endColumn || endRow >= 1_048_576 || endColumn >= 16_384) return false;
  if (endRow - startRow >= 100_000 || endColumn - startColumn >= 100_000) return false;
  return startRow !== endRow || startColumn !== endColumn;
}

function mergeRangesOK(ranges: unknown): boolean {
  return Array.isArray(ranges) && ranges.length > 0 && ranges.every((range) => mergeRangeOK(range));
}

function mergeCommandAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as {
    unitId?: unknown; subUnitId?: unknown; selections?: unknown; ranges?: unknown; value?: unknown;
  } | undefined;
  if (event.id === "sheet.command.add-worksheet-merge") {
    // The base command the family commands dispatch: the expanded selections
    // are required (a direct call without them would read a live selection
    // this gate cannot see), bound to this workbook, with the merge-across
    // axis (Dimension.ROWS 1 / COLUMNS 2) when present.
    if (params?.value !== undefined && params.value !== 1 && params.value !== 2) return false;
    if (params?.unitId !== undefined && params.unitId !== `file-${state.file.sha256}`) return false;
    return mergeRangesOK(params?.selections);
  }
  if (params?.subUnitId !== undefined &&
    !(typeof params.subUnitId === "string" && liveSheetIds(state).has(params.subUnitId))) return false;
  // Family and remove commands are selection-driven: an explicit range set is
  // optional and bounded when present.
  if (params?.selections !== undefined && !mergeRangesOK(params.selections)) return false;
  if (params?.ranges !== undefined && !mergeRangesOK(params.ranges)) return false;
  return true;
}

function mergeMutationAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as { unitId?: string; subUnitId?: string; ranges?: unknown } | undefined;
  const sheetId = params?.subUnitId;
  return !!params && params.unitId === `file-${state.file.sha256}` && !!sheetId &&
    liveSheetIds(state).has(sheetId) && mergeRangesOK(params.ranges);
}

// ── sheets (B3) ────────────────────────────────────────────────────────────
//
// Exactly the pinned sheets commands the sheet-tab UI wires, plus the
// mutations those commands dispatch (undo replays mutations). The tab-colour
// commands (`sheet.command.set-tab-color` / `sheet.mutation.set-tab-color`)
// stay OUT on purpose: the vendored gateway has no tabColor write path, so
// the UI shows existing colours read-only and refusing the command keeps the
// policy honest about what can be saved. The split-copy marker mutation is a
// no-op handler the copy command needs for very large sheets.
//
// Liveness: sheet ids and names come from the vendored SheetJournal (file
// sheets with removals/renames applied, plus additions), so a command after a
// session rename validates against the name the user sees and an id added
// this session (or already removed) is judged correctly.

const SHEET_COMMANDS = new Set([
  "sheet.command.insert-sheet",
  "sheet.command.copy-sheet",
  "sheet.command.remove-sheet",
  "sheet.command.set-worksheet-name",
  "sheet.command.set-worksheet-order",
  "sheet.command.set-worksheet-hidden",
  "sheet.command.set-worksheet-show",
]);

interface SheetMutationParams {
  unitId?: unknown;
  subUnitId?: unknown;
  name?: unknown;
  hidden?: unknown;
  /** set-worksheet-order command: the destination index. */
  order?: unknown;
  fromOrder?: unknown;
  toOrder?: unknown;
  index?: unknown;
  sheet?: { id?: unknown; name?: unknown } | undefined;
}

function liveSheetIds(state: LazyWorkbookState): Set<string> {
  return new Set(liveSessionSheets(state).map((sheet) => sheet.id));
}

function sheetRefOK(value: unknown, state: LazyWorkbookState): boolean {
  return typeof value === "string" && liveSheetIds(state).has(value);
}

/** A 0-based tab position; `allowEnd` admits the append position (count). */
function sheetIndexOK(value: unknown, count: number, allowEnd: boolean): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count + (allowEnd ? 1 : 0);
}

function sheetNameValueOK(value: unknown): boolean {
  return typeof value === "string" && sheetNameShapeOK(value);
}

function sheetCommandAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as SheetMutationParams | undefined;
  const count = liveSessionSheets(state).length;
  if (params !== undefined && typeof params !== "object") return false;
  switch (event.id) {
    case "sheet.command.insert-sheet": {
      if (params?.index !== undefined && !sheetIndexOK(params.index, count, true)) return false;
      const name = params?.sheet?.name;
      if (name !== undefined && !sheetNameValueOK(name)) return false;
      const id = params?.sheet?.id;
      return id === undefined || (typeof id === "string" && id.length > 0);
    }
    case "sheet.command.copy-sheet":
    case "sheet.command.remove-sheet":
    case "sheet.command.set-worksheet-hidden":
    case "sheet.command.set-worksheet-show":
      // Selection-driven: an explicit sheet id is optional and must be live.
      return params?.subUnitId === undefined || sheetRefOK(params.subUnitId, state);
    case "sheet.command.set-worksheet-name":
      return sheetNameValueOK(params?.name) &&
        (params?.subUnitId === undefined || sheetRefOK(params.subUnitId, state));
    case "sheet.command.set-worksheet-order":
      return sheetIndexOK(params?.order, count, false) &&
        (params?.subUnitId === undefined || sheetRefOK(params.subUnitId, state));
  }
  return false;
}

function sheetMutationAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as SheetMutationParams | undefined;
  if (!params || params.unitId !== `file-${state.file.sha256}`) return false;
  const count = liveSessionSheets(state).length;
  switch (event.id) {
    case "sheet.mutation.insert-sheet": {
      const id = params.sheet?.id;
      if (typeof id !== "string" || id.length === 0 || !sheetNameValueOK(params.sheet?.name)) return false;
      return sheetIndexOK(params.index, count, true);
    }
    case "sheet.mutation.remove-sheet":
      // The command itself refuses the last sheet; the gate refuses it first.
      return count > 1 && sheetRefOK(params.subUnitId, state);
    case "sheet.mutation.set-worksheet-name":
      return sheetRefOK(params.subUnitId, state) && sheetNameValueOK(params.name);
    case "sheet.mutation.set-worksheet-order":
      return sheetRefOK(params.subUnitId, state) &&
        sheetIndexOK(params.fromOrder, count, false) && sheetIndexOK(params.toOrder, count, false);
    case "sheet.mutation.set-worksheet-hidden":
      return sheetRefOK(params.subUnitId, state) && (params.hidden === 0 || params.hidden === 1);
    case "sheet.mutation.copy-worksheet-end":
      return sheetRefOK(params.subUnitId, state);
  }
  return false;
}

// ── filters (B4: auto filter / advanced filter) ────────────────────────────
//
// Exactly the pinned filter commands the Data-tab group and the header filter
// panel dispatch, plus the four mutations those commands run (undo replays the
// mutations; the pinned plugin's ref-range handler also injects a
// set-filter-range mutation after an insert/remove rows/cols command). Filter
// state is declarative — the save snapshots the live model — so the validators
// only bound params: the filter area stays inside the grid and under the span
// ceiling, criteria columns/values/operators stay under the wire bounds. Color
// criteria pass the gate (the pinned panel offers them) but have no OOXML
// mapping; the save-side snapshot refuses them with a message instead of
// silently dropping criteria. Default deny stays.

const FILTER_COMMANDS = new Set([
  "sheet.command.set-filter-range",
  "sheet.command.remove-sheet-filter",
  "sheet.command.smart-toggle-filter",
  "sheet.command.set-filter-criteria",
  "sheet.command.clear-filter-criteria",
  "sheet.command.re-calc-filter",
]);

/** The OOXML customFilter operators + the filter bounds the ops.ts parsers and
 *  the vendored wire schema share. */
const FILTER_OPERATORS = new Set([
  "equal", "notEqual", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual",
]);
const FILTER_VALUE_LEN = 32_767;
const FILTER_VALUES_MAX = 10_000;

function filterAreaOK(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const area = value as Record<string, unknown>;
  if (![area.startRow, area.endRow, area.startColumn, area.endColumn].every(
    (field) => typeof field === "number" && Number.isInteger(field) && field >= 0)) return false;
  const { startRow, endRow, startColumn, endColumn } =
    area as { startRow: number; endRow: number; startColumn: number; endColumn: number };
  if (startRow > endRow || startColumn > endColumn || endRow >= 1_048_576 || endColumn >= 16_384) return false;
  return endRow - startRow < 100_000 && endColumn - startColumn < 100_000;
}

/** A filter column's criteria as the pinned commands carry it: an
 *  IFilterColumn (values/blank, custom filters, or color filters) or null to
 *  clear the column. A column with no criteria family would make the pinned
 *  filter model throw, so it is refused here too. */
function filterCriteriaOK(criteria: unknown): boolean {
  if (criteria === null) return true;
  if (!criteria || typeof criteria !== "object") return false;
  const column = criteria as { colId?: unknown; filters?: unknown; customFilters?: unknown; colorFilters?: unknown };
  if (column.colId !== undefined && !(typeof column.colId === "number" && Number.isInteger(column.colId) &&
    column.colId >= 0 && column.colId < 16_384)) return false;
  let present = false;
  if (column.filters !== undefined) {
    if (!column.filters || typeof column.filters !== "object") return false;
    const filters = column.filters as { blank?: unknown; filters?: unknown };
    if (filters.blank !== undefined && typeof filters.blank !== "boolean") return false;
    if (filters.filters !== undefined) {
      if (!Array.isArray(filters.filters) || filters.filters.length > FILTER_VALUES_MAX) return false;
      if (!filters.filters.every((value) => typeof value === "string" && value.length <= FILTER_VALUE_LEN)) return false;
    }
    if (filters.blank !== undefined || filters.filters !== undefined) present = true;
  }
  if (column.customFilters !== undefined) {
    if (!column.customFilters || typeof column.customFilters !== "object") return false;
    const customs = column.customFilters as { and?: unknown; customFilters?: unknown };
    if (customs.and !== undefined && customs.and !== 0 && customs.and !== 1 && customs.and !== true) return false;
    if (!Array.isArray(customs.customFilters) || customs.customFilters.length < 1 || customs.customFilters.length > 2) return false;
    for (const custom of customs.customFilters) {
      if (!custom || typeof custom !== "object") return false;
      const condition = custom as { val?: unknown; operator?: unknown };
      const val = condition.val;
      if (typeof val === "string") {
        if (val.length > FILTER_VALUE_LEN) return false;
      } else if (typeof val !== "number" || !Number.isFinite(val)) return false;
      if (condition.operator !== undefined && (typeof condition.operator !== "string" || !FILTER_OPERATORS.has(condition.operator))) return false;
    }
    present = true;
  }
  if (column.colorFilters !== undefined) {
    if (!column.colorFilters || typeof column.colorFilters !== "object") return false;
    const colors = column.colorFilters as { cellFillColors?: unknown; cellTextColors?: unknown };
    for (const group of [colors.cellFillColors, colors.cellTextColors]) {
      if (group === undefined) continue;
      if (!Array.isArray(group) || group.length > FILTER_VALUES_MAX) return false;
      if (!group.every((color) => color === null || typeof color === "string")) return false;
    }
    present = true;
  }
  return present;
}

interface FilterParams {
  unitId?: unknown;
  subUnitId?: unknown;
  range?: unknown;
  col?: unknown;
  criteria?: unknown;
}

/** The pinned filter commands are sheet-scoped: `subUnitId`/`unitId` are
 *  optional (the command resolves the active sheet) and must name this
 *  workbook's live sheet when present. */
function filterSheetScopeOK(params: FilterParams | undefined, state: LazyWorkbookState): boolean {
  if (params !== undefined && (typeof params !== "object" || params === null)) return false;
  if (params?.unitId !== undefined && params.unitId !== `file-${state.file.sha256}`) return false;
  if (params?.subUnitId === undefined) return true;
  return typeof params.subUnitId === "string" && liveSheetIds(state).has(params.subUnitId);
}

function filterColOK(col: unknown): boolean {
  return typeof col === "number" && Number.isInteger(col) && col >= 0 && col < 16_384;
}

function filterCommandAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as FilterParams | undefined;
  if (!filterSheetScopeOK(params, state)) return false;
  if (event.id === "sheet.command.set-filter-range") return filterAreaOK(params?.range);
  if (event.id === "sheet.command.set-filter-criteria") {
    return filterColOK(params?.col) && filterCriteriaOK(params?.criteria);
  }
  return true;
}

function filterMutationAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as FilterParams | undefined;
  if (!params || typeof params !== "object" || params.unitId !== `file-${state.file.sha256}` ||
    typeof params.subUnitId !== "string" || !liveSheetIds(state).has(params.subUnitId)) return false;
  if (event.id === "sheet.mutation.set-filter-range") return filterAreaOK(params.range);
  if (event.id === "sheet.mutation.set-filter-criteria") {
    return filterColOK(params.col) && filterCriteriaOK(params.criteria);
  }
  return true;
}

// ── sort (A7: sort ascending / descending / custom) ─────────────────────────
//
// Exactly the pinned sort command the Data-tab group dispatches and the two
// commands/mutations it re-dispatches internally:
//   sheet.command.sort-range -> sheet.command.reorder-range
//     -> sheet.mutation.reorder-range
// The sort reorders whole rows in place. Validators bound the sorted rectangle
// and every sort key / order-map entry to the live grid; default deny stays.
//
// NOTE (A7 r2): the shim controller's CommandExecuted ingest does NOT handle
// sheet.mutation.reorder-range yet, so today the model sorts but the journal
// stays empty (no save). See worker-A7-r2.md; the capture is a shim change
// (controller.ts + edits.ts) outside this task's owned paths.

const SORT_COMMANDS = new Set([
  "sheet.command.sort-range",
  "sheet.command.reorder-range",
]);

const SORT_MUTATIONS = new Set([
  "sheet.mutation.reorder-range",
]);

const SORT_DIRECTIONS = new Set(["asc", "desc"]);

/** One sort key: a known direction and a 0-based column inside the sorted
 *  range. A bounded list keeps the pinned multi-rule comparator from being
 *  driven by an oversized payload. */
function sortOrderRulesOK(value: unknown, range: Record<string, unknown>): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  const startColumn = range.startColumn;
  const endColumn = range.endColumn;
  if (typeof startColumn !== "number" || typeof endColumn !== "number") return false;
  return value.every((rule) => {
    if (!rule || typeof rule !== "object") return false;
    const { type, colIndex } = rule as { type?: unknown; colIndex?: unknown };
    return typeof type === "string" && SORT_DIRECTIONS.has(type) &&
      typeof colIndex === "number" && Number.isInteger(colIndex) &&
      colIndex >= startColumn && colIndex <= endColumn;
  });
}

/** A reorder-range order map: integer target row -> source row, both inside the
 *  sorted range. */
function sortOrderMapOK(value: unknown, range: Record<string, unknown>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const startRow = range.startRow;
  const endRow = range.endRow;
  if (typeof startRow !== "number" || typeof endRow !== "number") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([target, source]) => {
    const targetRow = Number(target);
    return Number.isInteger(targetRow) && targetRow >= startRow && targetRow <= endRow &&
      typeof source === "number" && Number.isInteger(source) && source >= startRow && source <= endRow;
  });
}

/** The pinned sort commands/mutations all carry the workbook and sheet they
 *  address (the group fills them, and the pinned dispatcher passes the location
 *  through); both must name this workbook and a live sheet. */
function sortScopeOK(
  params: { unitId?: unknown; subUnitId?: unknown } | undefined,
  state: LazyWorkbookState,
): boolean {
  if (!params || typeof params !== "object") return false;
  if (params.unitId !== `file-${state.file.sha256}`) return false;
  return typeof params.subUnitId === "string" && liveSheetIds(state).has(params.subUnitId);
}

function sortCommandAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as {
    unitId?: unknown; subUnitId?: unknown; range?: unknown; orderRules?: unknown; hasTitle?: unknown;
  } | undefined;
  if (!sortScopeOK(params, state) || !params || !filterAreaOK(params.range)) return false;
  return sortOrderRulesOK(params.orderRules, params.range as Record<string, unknown>) &&
    (params.hasTitle === undefined || typeof params.hasTitle === "boolean");
}

function sortReorderAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as {
    unitId?: unknown; subUnitId?: unknown; range?: unknown; order?: unknown;
  } | undefined;
  if (!sortScopeOK(params, state) || !params || !filterAreaOK(params.range)) return false;
  return sortOrderMapOK(params.order, params.range as Record<string, unknown>);
}

/** Original content must be installed before an undoable user edit. */
export function canEditRange(state: LazyWorkbookState | null, sheetId: string, range: IRange): boolean {
  const sheet = state?.file.sheets.find((candidate) => candidate.id === sheetId);
  if (!state || !validRange(range)) return false;
  // A sheet added this session is fully in-memory: no streaming window and no
  // pivot/frozen metadata bounds it.
  if (!sheet) return liveSheetIds(state).has(sheetId);
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
    if (MERGE_COMMANDS.has(event.id)) return mergeCommandAllowed(event, state);
    if (SHEET_COMMANDS.has(event.id)) return sheetCommandAllowed(event, state);
    if (STRUCTURAL_MUTATIONS[event.id]) return structuralMutationAllowed(event, state);
    if (MERGE_MUTATIONS.has(event.id)) return mergeMutationAllowed(event, state);
    if (isSheetMutation(event.id)) return sheetMutationAllowed(event, state);
    if (FILTER_COMMANDS.has(event.id)) return filterCommandAllowed(event, state);
    if (FILTER_MUTATIONS.has(event.id)) return filterMutationAllowed(event, state);
    if (SORT_COMMANDS.has(event.id)) {
      return event.id === "sheet.command.sort-range" ? sortCommandAllowed(event, state) : sortReorderAllowed(event, state);
    }
    if (SORT_MUTATIONS.has(event.id)) return sortReorderAllowed(event, state);
    return EDIT_COMMANDS.has(event.id);
  }
  const params = event.params as {
    unitId?: string; subUnitId?: string; cellValue?: unknown;
    ranges?: IRange[]; values?: Record<string, { ranges?: IRange[] }>; trigger?: string;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
    !liveSheetIds(state).has(sheetId)) return false;
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
