import {
  recordFilterChange,
  recordSetNumfmt,
  recordSetRangeValues,
  recordSheetDuplicate,
  recordSheetHidden,
  recordSheetInsert,
  recordSheetOrderChange,
  recordSheetRemove,
  recordSheetRename,
  recordStructuralOp,
  recordNoteChange,
  recordHyperlinkEdit,
  recordTableAdd,
  removeTableAdd,
  type JournalEntry,
  type StructuralJournalOp,
} from "../../upstream/apps/sheets/src/renderer/edit-journal";
import { FILTER_MUTATIONS, REORDER_RANGE_MUTATION, pixelsToCharacterWidth } from "../../upstream/apps/sheets/src/renderer/app-constants";
import type { SharedFormulaResolver } from "../../upstream/apps/sheets/src/renderer/shared-formula-journal";
import type { LazyWorkbookState, UniverWorksheet } from "../../upstream/apps/sheets/src/renderer/univer-state";
import type { IExecutionOptions } from "@univerjs/core";
import type { XlsxRendererRuleSetEdit } from "./rule-set-capture";
import { t } from "./locale";

export interface XlsxRendererCellEdit {
  sheetId: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

/** One row/column structural edit: the journal op the vendored edit-journal
 *  recorded (cell entries are already shifted into its post-operation
 *  coordinates by recordStructuralOp) plus the grid sheet id. */
export interface XlsxRendererStructuralEdit {
  sheetId: string;
  structural: StructuralJournalOp;
}

/** One worksheet-level edit (B3): the op plus the sheet's live name at
 *  emission. Per kind: add/duplicate name the NEW sheet (index = final tab
 *  position; duplicate also names its source), remove/rename name the target
 *  (`rename-sheet` carries the PRE-mutation name in `sheetName` and the new
 *  one in `newName`), reorder/hide name the unchanged sheet. */
export interface XlsxRendererSheetEdit {
  sheetId: string;
  sheetName: string;
  sheetOp: RendererSheetJournalOp;
}

export type RendererSheetJournalOp =
  | { kind: "add-sheet"; index: number }
  | { kind: "duplicate-sheet"; sourceSheetId: string; sourceName: string; index: number }
  | { kind: "remove-sheet" }
  | { kind: "rename-sheet"; newName: string }
  | { kind: "set-sheet-hidden"; hidden: boolean }
  | { kind: "reorder-sheet"; index: number };

/** One custom filter condition (upstream FilterColumnState.customs entry): a
 *  value and an optional OOXML comparison operator (absent = equality). */
export interface XlsxRendererFilterCustomCondition {
  val: string | number;
  operator?: string;
}

/** One filter column's criteria; colId is the 0-based offset inside the filter
 *  range (OOXML filterColumn/@colId). */
export interface XlsxRendererFilterColumnState {
  colId: number;
  values?: string[];
  blank?: boolean;
  customs?: { and?: boolean; filters: XlsxRendererFilterCustomCondition[] };
}

/** The declarative filter snapshot of one sheet: the filter rectangle and its
 *  per-column criteria (the engine's XlsxFilterSetState). */
export interface XlsxRendererFilterSetState {
  range: AxisRange;
  columns: XlsxRendererFilterColumnState[];
}

/** One filter edit (B4): the whole-sheet snapshot, or a clear (a removed
 *  filter) with only the visibility range the gateway unhides. `sheetName` is
 *  stamped by the controller when it differs from the host file's. */
export interface XlsxRendererFilterEdit {
  sheetId: string;
  sheetName?: string;
  filter: XlsxRendererFilterSetState | null;
  hiddenRows: number[];
  visibilityRange: AxisRange;
}

/** One table edit (B9): a table created this session (the gateway's
 *  TableAddition) or a remove that cancels an earlier session add by name.
 *  A file-native table has no removal write path and stays view-only. */
export interface XlsxRendererTableEdit {
  sheetId: string;
  table: { area: AxisRange; name: string; columnNames: string[]; style?: string; bandedRows: boolean } | null;
  name: string;
}

/** Everything the renderer's edit channel can emit. */
export interface XlsxRendererHyperlinkEdit {
  sheetId: string;
  sheetName?: string;
  row: number;
  column: number;
  target: string | null;
}

/** One note/comment edit (B6): the whole-sheet note snapshot after the change
 *  (an empty list removes every note). */
export interface XlsxRendererNotesEdit {
  sheetId: string;
  sheetName?: string;
  notes: { row: number; column: number; author: string; text: string }[];
}

export type XlsxRendererEdit =
  | XlsxRendererCellEdit
  | XlsxRendererStructuralEdit
  | XlsxRendererSheetEdit
  | XlsxRendererFilterEdit
  | XlsxRendererTableEdit
  | XlsxRendererHyperlinkEdit
  | XlsxRendererNotesEdit
  | XlsxRendererRuleSetEdit;

/** tableId -> {sheetId, name} for a session add, so the delete mutation (which
 *  carries only the tableId) can name the table it cancels. */
const pendingTableNames = new Map<string, { sheetId: string; name: string }>();

/** The sheet a session-added table lives on, or undefined for a table the
 *  session never added. Used by the policy/undo path, which must resolve the
 *  sheet for a delete mutation that carries only {tableId, unitId}. */
export function sessionTableSheetId(tableId: string): string | undefined {
  return pendingTableNames.get(tableId)?.sheetId;
}

/** The tableId of a session add on \`sheetId\` with \`name\` (case-insensitive),
 *  or undefined. The toolbar's Remove control sends a name, not an id. */
export function sessionTableIdForName(sheetId: string, name: string): string | undefined {
  const needle = name.toLowerCase();
  for (const [tableId, entry] of pendingTableNames) {
    if (entry.sheetId === sheetId && entry.name.toLowerCase() === needle) return tableId;
  }
  return undefined;
}

/** Ingest one table mutation (sheet.mutation.add-table / delete-table). The
 *  add carries the resolved name + header the pinned command built; the
 *  delete resolves the name through the add it is cancelling. The delete of an
 *  undone add carries only {tableId, unitId} (no subUnitId), so the sheet is
 *  resolved through the session map. */
export function ingestTableMutation(state: LazyWorkbookState | null, event: RendererCommand, suppressed = false): XlsxRendererTableEdit[] {
  if (!state || suppressed || event.options?.fromFormula) return [];
  const params = event.params as
    | { unitId?: string; subUnitId?: string; tableId?: string; name?: string; range?: AxisRange; header?: string[] }
    | undefined;
  if (!params || params.unitId !== `file-${state.file.sha256}`) return [];
  const liveSheets = liveSessionSheets(state);
  if (event.id === "sheet.mutation.delete-table") {
    const { tableId } = params;
    if (!tableId) return [];
    const known = pendingTableNames.get(tableId);
    if (!known) return [];
    // Undo of an add carries no subUnitId: resolve the sheet through the map.
    const sheetId = params.subUnitId ?? known.sheetId;
    if (known.sheetId !== sheetId || !liveSheets.some((sheet) => sheet.id === sheetId)) return [];
    if (!removeTableAdd(state.editJournal, sheetId, known.name)) return [];
    pendingTableNames.delete(tableId);
    return [{ sheetId, table: null, name: known.name }];
  }
  if (event.id !== "sheet.mutation.add-table") return [];
  const sheetId = params.subUnitId;
  if (!sheetId || !liveSheets.some((sheet) => sheet.id === sheetId)) return [];
  const { tableId, name, range, header } = params;
  if (!tableId || !name || !range || !Array.isArray(header) || header.length === 0) return [];
  const table = { area: { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn }, name, columnNames: [...header], bandedRows: true };
  recordTableAdd(state.editJournal, { sheetId, area: table.area, name, columnNames: [...header], bandedRows: true });
  pendingTableNames.set(tableId, { sheetId, name });
  return [{ sheetId, table, name }];
}

export interface RendererCommand {
  id: string;
  type?: number;
  params?: unknown;
  options?: IExecutionOptions;
}

export const CELL_MUTATIONS = new Set([
  "sheet.mutation.set-range-values",
  "sheet.mutation.set.numfmt",
  "sheet.mutation.remove.numfmt",
]);

/** Ingest only bound user mutations; undo/redo execute these same mutations. */
export function ingestCellMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  suppressed = false,
  resolveSharedFormula?: SharedFormulaResolver,
  readStyle?: (row: number, column: number) => Record<string, unknown> | undefined,
): XlsxRendererCellEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !CELL_MUTATIONS.has(event.id)) return [];
  const params = event.params as {
    unitId?: string; subUnitId?: string; cellValue?: unknown; ranges?: unknown;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return [];
  const before = new Map(state.editJournal.cells.get(sheetId));
  let recorded;
  if (event.id === "sheet.mutation.set.numfmt") {
    recorded = recordSetNumfmt(state.editJournal, sheetId, params);
  } else if (event.id === "sheet.mutation.remove.numfmt") {
    // Univer undoes a newly applied format by removing its numfmt entry.
    // The gateway's equivalent restoration is the default General format.
    recorded = recordSetNumfmt(state.editJournal, sheetId, {
      refMap: { general: { pattern: "General" } },
      values: { general: { ranges: params.ranges } },
    });
  } else {
    let cells = params.cellValue;
    if (cells && typeof cells === "object" && readStyle) {
      const normalized: Record<string, Record<string, unknown>> = {};
      for (const [row, values] of Object.entries(cells)) {
        if (!values || typeof values !== "object") continue;
        normalized[row] = {};
        for (const [column, cell] of Object.entries(values)) {
          let data = cell;
          if (cell && typeof cell === "object" && "s" in cell) {
            const style = (cell as { s?: unknown }).s;
            if (typeof style === "string") {
              data = { ...cell, s: readStyle(Number(row), Number(column)) ?? null };
            } else if (style && typeof style === "object" && Object.values(style).some((v) => v === null)) {
              // Null style attributes in undo mean removal. The vendored
              // converter cannot express every removal (e.g. fs:null), so
              // restore the complete post-mutation cell style after reset.
              recordSetRangeValues(state.editJournal, sheetId, { [row]: { [column]: { s: null } } });
              data = { ...cell, s: readStyle(Number(row), Number(column)) ?? null };
            }
          }
          normalized[row][column] = data;
        }
      }
      cells = normalized;
    }
    recorded = recordSetRangeValues(state.editJournal, sheetId, cells, resolveSharedFormula);
  }
  const changed = new Map<string, XlsxRendererCellEdit>();
  for (const entry of recorded) {
    const key = `${entry.row}:${entry.column}`;
    if (JSON.stringify(before.get(key)) === JSON.stringify(entry)) continue;
    changed.set(key, {
      sheetId, row: entry.row, column: entry.column,
      writeValue: entry.hasValue, value: entry.value,
      ...(entry.formula === undefined ? {} : { formula: entry.formula }),
      ...(entry.style === undefined ? {} : { style: { ...entry.style } }),
      ...(entry.styleReset ? { styleReset: true } : {}),
    });
  }
  return [...changed.values()];
}

// ── validated editor commits ───────────────────────────────────────────────
//
// The pinned editor applies a commit first, then validates the cell and, when
// a stop-style data-validation rule refuses the input, rolls the write back
// with plain mutations ({value: null, styleReset: true} in journal terms).
// Journaled as they run, a refused input leaves a value edit and then a reset
// behind, and the reset wipes the cell's saved format. The gate holds a
// commit's cell edits until the verdict: accepted edits are emitted as usual,
// a refusal restores the journal and swallows the rollback, so nothing about
// the refused write ever reaches the save queue. A plain undo of an accepted
// write is a later command and is untouched.

export interface ValidatedWriteGate {
  /** An editor commit on `sheetId` is about to run: hold its cell edits. */
  begin(state: LazyWorkbookState | null, sheetId: string, cell?: { row: number; column: number }): void;
  /** Returns the edits that may be emitted now (the held sheet's cell edits are kept back). */
  capture(edits: XlsxRendererCellEdit[]): XlsxRendererCellEdit[];
  /** The validation verdict of the pending commit is on its way; call the
   *  returned function with it, or null when nothing is pending. A verdict
   *  for another sheet (`sheetId` given and not the pending write's) is not
   *  the pending write's and gets null too (review-session n-1); so does a
   *  verdict for another cell when the commit's cell is known (a paste or an
   *  autofill validates several cells of one sheet in one tick, X2). */
  awaitVerdict(sheetId?: string, cell?: { row: number; column: number }): ((accepted: boolean) => void) | null;
  /** True while the rollback of a refused commit on `sheetId` runs. */
  isRollback(sheetId: string): boolean;
}

interface PendingValidatedWrite {
  state: LazyWorkbookState;
  sheetId: string;
  cell: { row: number; column: number } | undefined;
  before: Map<string, JournalEntry> | undefined;
  held: XlsxRendererCellEdit[];
  awaited: boolean;
}

/** The cell an editor commit writes: its set-range-values range is that one
 *  cell (Univer 0.25.1 `_submitEdit`), and the verdict that matters is the one
 *  asked for the same cell. Any other shape names no cell. */
export function editorCommitCell(range: unknown): { row: number; column: number } | undefined {
  const at = range as Partial<AxisRange> | null | undefined;
  if (typeof at?.startRow !== "number" || typeof at.startColumn !== "number") return undefined;
  return at.startRow === at.endRow && at.startColumn === at.endColumn ? { row: at.startRow, column: at.startColumn } : undefined;
}

export function createValidatedWriteGate(emit: (edits: XlsxRendererCellEdit[]) => void): ValidatedWriteGate {
  let pending: PendingValidatedWrite | null = null;
  let rollbackSheetId: string | null = null;

  const settle = (write: PendingValidatedWrite, accepted: boolean): void => {
    if (pending !== write) return;
    pending = null;
    if (accepted) {
      if (write.held.length > 0) emit(write.held);
      return;
    }
    const cells = write.state.editJournal.cells;
    if (write.before === undefined) {
      cells.delete(write.sheetId);
    } else {
      const live = cells.get(write.sheetId) ?? new Map<string, JournalEntry>();
      live.clear();
      for (const [key, entry] of write.before) live.set(key, entry);
      cells.set(write.sheetId, live);
    }
    // The editor rolls back synchronously once the verdict resolves; the flag
    // outlives that microtask chain and nothing else.
    rollbackSheetId = write.sheetId;
    setTimeout(() => { if (rollbackSheetId === write.sheetId) rollbackSheetId = null; }, 0);
  };

  return {
    begin(state, sheetId, cell) {
      if (pending) settle(pending, true);
      if (!state) return;
      const journaled = state.editJournal.cells.get(sheetId);
      const write: PendingValidatedWrite = {
        state, sheetId, cell, before: journaled ? new Map(journaled) : undefined, held: [], awaited: false,
      };
      pending = write;
      // The editor asks for the verdict in the same tick as the command; when
      // it does not (the command was refused), the write stands as accepted.
      queueMicrotask(() => { if (!write.awaited) settle(write, true); });
    },
    capture(edits) {
      const write = pending;
      if (!write || edits.length === 0) return edits;
      const held = edits.filter((edit) => edit.sheetId === write.sheetId);
      if (held.length === 0) return edits;
      write.held.push(...held);
      return edits.filter((edit) => edit.sheetId !== write.sheetId);
    },
    awaitVerdict(sheetId, cell) {
      const write = pending;
      if (!write || (sheetId !== undefined && sheetId !== write.sheetId)) return null;
      if (write.cell && cell && (cell.row !== write.cell.row || cell.column !== write.cell.column)) return null;
      write.awaited = true;
      return (accepted) => settle(write, accepted);
    },
    isRollback: (sheetId) => rollbackSheetId === sheetId,
  };
}

/**
 * Univer composes VALIDATE_CELL interceptors in a flat loop that stops at the
 * first handler which has not called `next` synchronously. The data-validation
 * handler is async and calls it only after its awaits, so no interceptor
 * ordered after it ever runs and none can see the verdict. The verdict is the
 * promise `onValidateCell` returns to the editor instead: this wraps that
 * method, asks the gate for its settle function in the same tick (before the
 * gate's microtask release) and settles it ahead of the editor's own await, so
 * the editor's rollback runs after the gate knows about the refusal.
 */
export interface ValidateCellSource {
  onValidateCell(...args: unknown[]): unknown;
}

export function observeValidationVerdicts(source: ValidateCellSource, gate: ValidatedWriteGate): { dispose(): void } {
  const original = source.onValidateCell;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const verdict = original.apply(this ?? source, args);
    // Univer 0.25.1: onValidateCell(workbook, worksheet, row, col).
    const worksheet = args[1] as { getSheetId?: unknown } | null | undefined;
    const sheetId = typeof worksheet?.getSheetId === "function" ? (worksheet.getSheetId as () => unknown)() : undefined;
    const [row, column] = [args[2], args[3]];
    const cell = typeof row === "number" && typeof column === "number" ? { row, column } : undefined;
    const settle = gate.awaitVerdict(typeof sheetId === "string" ? sheetId : undefined, cell);
    if (settle) Promise.resolve(verdict).then((accepted) => settle(accepted !== false), () => settle(true));
    return verdict;
  };
  source.onValidateCell = wrapped;
  return {
    dispose() {
      if (source.onValidateCell === wrapped) source.onValidateCell = original;
    },
  };
}

// ── structural (rows/columns) capture ──────────────────────────────────────
//
// The pinned Univer has no outline model and the journal keeps no structural
// history of its own; the vendored edit-journal does, and these mutation maps
// name the row/column changes the renderer emits for it. recordStructuralOp
// shifts the journal's cell entries into post-operation coordinates, so a
// cell edit that reached the save queue before a shift is later moved by the
// engine model with the same rule and both sides agree on final coordinates.

export interface AxisRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

interface StructuralMutationParams {
  unitId?: string;
  subUnitId?: string;
  range?: AxisRange;
  ranges?: AxisRange[];
  rowHeight?: number | Record<string, number>;
  colWidth?: number | Record<string, number>;
  autoHeightInfo?: number | Record<string, number>;
}

const ROW_COLUMN_MUTATIONS: Record<
  string,
  { kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols"; axis: "row" | "column" }
> = {
  "sheet.mutation.insert-row": { kind: "insert-rows", axis: "row" },
  "sheet.mutation.remove-rows": { kind: "remove-rows", axis: "row" },
  "sheet.mutation.insert-col": { kind: "insert-cols", axis: "column" },
  "sheet.mutation.remove-col": { kind: "remove-cols", axis: "column" },
};

const AXIS_ATTR_MUTATIONS: Record<
  string,
  { kind: "size" | "hidden" | "auto-size"; axis: "row" | "column"; hidden?: boolean }
> = {
  "sheet.mutation.set-worksheet-row-height": { kind: "size", axis: "row" },
  "sheet.mutation.set-worksheet-col-width": { kind: "size", axis: "column" },
  "sheet.mutation.set-worksheet-row-is-auto-height": { kind: "auto-size", axis: "row" },
  "sheet.mutation.set-row-hidden": { kind: "hidden", axis: "row", hidden: true },
  "sheet.mutation.set-row-visible": { kind: "hidden", axis: "row", hidden: false },
  "sheet.mutation.set-col-hidden": { kind: "hidden", axis: "column", hidden: true },
  "sheet.mutation.set-col-visible": { kind: "hidden", axis: "column", hidden: false },
};

/** Ingest the row/column structure a mutation carries. The span guard mirrors
 *  the genoffice wire refine (100k lines) so a malformed range never spins. */
export function ingestStructuralMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  suppressed = false,
): XlsxRendererStructuralEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !event.id.startsWith("sheet.mutation.")) return [];
  const rowColumn = ROW_COLUMN_MUTATIONS[event.id];
  const axisAttr = AXIS_ATTR_MUTATIONS[event.id];
  if (!rowColumn && !axisAttr) return [];
  const params = event.params as StructuralMutationParams | undefined;
  const sheetId = params?.subUnitId;
  const liveSheets = liveSessionSheets(state);
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSheets.some((sheet) => sheet.id === sheetId)) return [];
  const sheetName = liveSheets.find((sheet) => sheet.id === sheetId)?.name;
  const edits: XlsxRendererStructuralEdit[] = [];
  const record = (structural: StructuralJournalOp): void => {
    recordStructuralOp(state.editJournal, sheetId, structural, sheetName);
    edits.push({ sheetId, structural });
  };
  if (rowColumn) {
    const range = params.range;
    if (!range) return [];
    const index = rowColumn.axis === "row" ? range.startRow : range.startColumn;
    const count =
      rowColumn.axis === "row" ? range.endRow - range.startRow + 1 : range.endColumn - range.startColumn + 1;
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(count) || count <= 0) return [];
    record({ kind: rowColumn.kind, index, count });
    shiftOutlineLines(state, sheetId, rowColumn.kind, index, count);
    return edits;
  }
  // File units: row heights are points (px * 0.75), column widths character
  // units — the same conversion the genoffice UI applied before journalling.
  const attr = axisAttr!;
  const axis = attr.axis;
  const sizeKind = axis === "row" ? ("set-row-size" as const) : ("set-col-size" as const);
  const toFileSize = (pixels: number): number =>
    axis === "row" ? Math.round(pixels * 0.75 * 100) / 100 : pixelsToCharacterWidth(pixels);
  const uniform = axis === "row" ? params.rowHeight : params.colWidth;
  for (const range of params.ranges ?? []) {
    const start = axis === "row" ? range.startRow : range.startColumn;
    const end = axis === "row" ? range.endRow : range.endColumn;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start >= 100_000) continue;
    if (attr.kind === "hidden") {
      record({ kind: axis === "row" ? "set-rows-hidden" : "set-cols-hidden", start, end, hidden: attr.hidden === true });
    } else if (attr.kind === "auto-size") {
      // Setting an explicit height also emits this mutation with 0 (auto
      // off); only auto ON resets the height to the sheet default.
      const info = params.autoHeightInfo;
      if (typeof info === "number") {
        if (info === 1) record({ kind: sizeKind, start, end, size: null });
      } else if (info && typeof info === "object") {
        for (let line = start; line <= end; line += 1) {
          if (info[line] !== 1) continue;
          record({ kind: sizeKind, start: line, end: line, size: null });
        }
      }
    } else if (typeof uniform === "number") {
      record({ kind: sizeKind, start, end, size: toFileSize(uniform) });
    } else if (uniform && typeof uniform === "object") {
      // Per-line sizes (undo restores): one op per line in the range.
      for (let line = start; line <= end; line += 1) {
        const pixels = uniform[line];
        if (typeof pixels !== "number") continue;
        record({ kind: sizeKind, start: line, end: line, size: toFileSize(pixels) });
      }
    }
  }
  return edits;
}

// ── merge capture (B2) ─────────────────────────────────────────────────────
//
// `sheet.mutation.add-worksheet-merge` carries the exact post-expansion merge
// rectangles (one per row for a "merge across"), so the journal records one
// merge-cells op per range in emission order. `sheet.mutation.remove-worksheet-merge`
// carries the user's SELECTION ranges — the mutation removes every merge
// intersecting them — so the removed rectangles are computed from the
// pre-mutation merge list and passed in here; recording the selection instead
// would unmerge nothing at save (the gateway removes by exact ref). Merges
// never shift cells, so recordStructuralOp leaves the cell journal untouched.

const MERGE_MUTATIONS: Readonly<Record<string, "merge-cells" | "unmerge-cells">> = {
  "sheet.mutation.add-worksheet-merge": "merge-cells",
  "sheet.mutation.remove-worksheet-merge": "unmerge-cells",
};

/** True when the selection spans exactly one live merge: Excel treats that as a
 *  single cell. Tolerates a missing or malformed merge list (older facades). */
export function selectsOneMergedCell(merges: unknown, selection: AxisRange): boolean {
  if (!Array.isArray(merges)) return false;
  return merges.some((merge: Partial<AxisRange> | null) =>
    merge?.startRow === selection.startRow && merge.endRow === selection.endRow &&
    merge.startColumn === selection.startColumn && merge.endColumn === selection.endColumn);
}

/** The file merges an unmerge selection removes: every merge rectangle the
 *  selection intersects, the same rule the mutation applies. */
export function intersectMergeRanges(
  merges: readonly AxisRange[],
  selections: readonly AxisRange[],
): AxisRange[] {
  return merges.filter((merge) =>
    selections.some(
      (selection) =>
        merge.startRow <= selection.endRow && selection.startRow <= merge.endRow &&
        merge.startColumn <= selection.endColumn && selection.startColumn <= merge.endColumn,
    ),
  );
}

/** A merge rectangle inside the wire bounds: integers, ordered, in-grid, under
 *  the span ceiling and at least two cells (the ops.ts parseMergeArea bounds). */
function mergeRangeOK(range: unknown): range is AxisRange {
  if (!range || typeof range !== "object") return false;
  const { startRow, endRow, startColumn, endColumn } = range as AxisRange;
  if (![startRow, endRow, startColumn, endColumn].every((value) => Number.isInteger(value) && value >= 0)) return false;
  if (startRow > endRow || startColumn > endColumn || endRow >= 1_048_576 || endColumn >= 16_384) return false;
  if (endRow - startRow >= 100_000 || endColumn - startColumn >= 100_000) return false;
  return startRow !== endRow || startColumn !== endColumn;
}

/** Ingest the merge rectangles a merge mutation carries. `removedMerges` is
 *  the pre-mutation intersect for a remove mutation (see the controller); the
 *  add mutation's own ranges are already the exact rectangles. */
export function ingestMergeMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  suppressed = false,
  removedMerges?: readonly AxisRange[] | undefined,
): XlsxRendererStructuralEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !event.id.startsWith("sheet.mutation.")) return [];
  const kind = MERGE_MUTATIONS[event.id];
  if (!kind) return [];
  const params = event.params as StructuralMutationParams | undefined;
  const sheetId = params?.subUnitId;
  const liveSheets = liveSessionSheets(state);
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSheets.some((sheet) => sheet.id === sheetId)) return [];
  const ranges = kind === "unmerge-cells" ? removedMerges ?? [] : params.ranges;
  if (!Array.isArray(ranges)) return [];
  const sheetName = liveSheets.find((sheet) => sheet.id === sheetId)?.name;
  const edits: XlsxRendererStructuralEdit[] = [];
  for (const range of ranges) {
    if (!mergeRangeOK(range)) continue;
    const structural = {
      kind,
      range: { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn },
    };
    recordStructuralOp(state.editJournal, sheetId, structural, sheetName);
    edits.push({ sheetId, structural });
  }
  return edits;
}

// ── sheet ops (B3: add / rename / remove / duplicate / reorder / hide) ─────
//
// Exactly the five sheet mutations the pinned sheets plugin dispatches (their
// commands are allowlisted in command-policy.ts). The vendored edit-journal
// already owns a SheetJournal; these records only feed its grid overlay — the
// save payload is the emitted edit, which the views bridge turns into an
// envelope sheet op. Duplicating also copies the journal's cell/structural
// entries onto the new sheet id, but the ENGINE session model clones its own
// pending state on `duplicate_sheet`, so no cloned cell edit is emitted twice.
//
// Sheet names are the live (Univer) names: a rename earlier in the session
// changes what later mutations must address, and the mutation params do not
// carry the pre-mutation name, so the controller snapshots it in
// BeforeCommandExecute and passes it here.

const SHEET_MUTATIONS = new Set([
  "sheet.mutation.insert-sheet",
  "sheet.mutation.remove-sheet",
  "sheet.mutation.set-worksheet-name",
  "sheet.mutation.set-worksheet-order",
  "sheet.mutation.set-worksheet-hidden",
  // The split-copy end marker (very large sheets): a no-op handler the copy
  // command dispatches; journalled by nothing and emitted not at all.
  "sheet.mutation.copy-worksheet-end",
]);

export function isSheetMutation(id: string): boolean {
  return SHEET_MUTATIONS.has(id);
}

/** The session's live sheet list — file sheets with removals/renames applied,
 *  plus sheets added this session — derived from the vendored SheetJournal,
 *  which every sheet mutation records into as it runs. Read BEFORE a mutation
 *  records itself (the CommandExecuted handler does), it is the pre-mutation
 *  state, which is exactly what a rename target needs. */
export function liveSessionSheets(state: LazyWorkbookState): { id: string; name: string }[] {
  const { added, removed, renamed } = state.editJournal.sheets;
  const sheets: { id: string; name: string }[] = [];
  for (const sheet of state.file.sheets) {
    if (removed.has(sheet.id) || added.has(sheet.id)) continue;
    sheets.push({ id: sheet.id, name: renamed.get(sheet.id) ?? sheet.name });
  }
  for (const [id, entry] of added) {
    if (!removed.has(id)) sheets.push({ id, name: entry.name });
  }
  return sheets;
}

export interface XlsxSheetMutationContext {
  /** Copy provenance when this insert-sheet mutation came from copy-sheet. */
  copy?: { sourceSheetId: string; sourceName: string } | undefined;
}

/** Ingest one sheet mutation. Returns the journal edit the bridge maps to an
 *  envelope sheet op, or [] for a shape the policy/bridge must not see. */
export function ingestSheetMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  suppressed = false,
  context: XlsxSheetMutationContext = {},
): XlsxRendererSheetEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !isSheetMutation(event.id)) return [];
  const params = event.params as
    | {
        unitId?: unknown;
        subUnitId?: unknown;
        subUnitName?: unknown;
        name?: unknown;
        hidden?: unknown;
        fromOrder?: unknown;
        toOrder?: unknown;
        index?: unknown;
        sheet?: { id?: unknown; name?: unknown } | undefined;
      }
    | undefined;
  if (!params || typeof params !== "object" || params.unitId !== `file-${state.file.sha256}`) return [];
  // The split-copy marker carries no sheet change; the insert mutation it
  // follows already emitted the duplicate.
  if (event.id === "sheet.mutation.copy-worksheet-end") return [];
  const liveSheets = liveSessionSheets(state);

  if (event.id === "sheet.mutation.insert-sheet") {
    const id = params.sheet?.id;
    const name = params.sheet?.name;
    const index = params.index;
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string" || !sheetNameShapeOK(name)) return [];
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > liveSheets.length) return [];
    if (context.copy !== undefined && context.copy !== null) {
      recordSheetDuplicate(state.editJournal, id, name, context.copy.sourceSheetId);
      return [
        {
          sheetId: id,
          sheetName: name,
          sheetOp: {
            kind: "duplicate-sheet",
            sourceSheetId: context.copy.sourceSheetId,
            sourceName: context.copy.sourceName,
            index: index as number,
          },
        },
      ];
    }
    recordSheetInsert(state.editJournal, id, name);
    return [{ sheetId: id, sheetName: name, sheetOp: { kind: "add-sheet", index: index as number } }];
  }

  const sheetId = params.subUnitId;
  if (typeof sheetId !== "string" || sheetId.length === 0) return [];
  const sheetName = liveSheets.find((sheet) => sheet.id === sheetId)?.name;
  if (sheetName === undefined) return [];

  if (event.id === "sheet.mutation.remove-sheet") {
    // The mutation carries the removed sheet's live name (subUnitName); the
    // live lookup is pre-mutation, so either is the same name here.
    const name = typeof params.subUnitName === "string" && params.subUnitName.length > 0 ? params.subUnitName : sheetName;
    recordSheetRemove(state.editJournal, sheetId);
    return [{ sheetId, sheetName: name, sheetOp: { kind: "remove-sheet" } }];
  }

  if (event.id === "sheet.mutation.set-worksheet-name") {
    const name = params.name;
    if (typeof name !== "string" || !sheetNameShapeOK(name)) return [];
    if (sheetName === name) return [];
    recordSheetRename(state.editJournal, sheetId, name, state.file.sheets.find((sheet) => sheet.id === sheetId)?.name);
    return [{ sheetId, sheetName, sheetOp: { kind: "rename-sheet", newName: name } }];
  }

  if (event.id === "sheet.mutation.set-worksheet-order") {
    const toOrder = params.toOrder;
    if (!Number.isInteger(toOrder) || (toOrder as number) < 0 || (toOrder as number) >= liveSheets.length) return [];
    recordSheetOrderChange(state.editJournal);
    return [{ sheetId, sheetName, sheetOp: { kind: "reorder-sheet", index: toOrder as number } }];
  }

  // set-worksheet-hidden: Univer carries BooleanNumber (0/1); normalize.
  const hidden = params.hidden;
  if (hidden !== 0 && hidden !== 1 && hidden !== true && hidden !== false) return [];
  const fileHidden = state.file.sheets.find((sheet) => sheet.id === sheetId)?.hidden === true;
  recordSheetHidden(state.editJournal, sheetId, hidden === true || hidden === 1, fileHidden);
  return [{ sheetId, sheetName, sheetOp: { kind: "set-sheet-hidden", hidden: hidden === true || hidden === 1 } }];
}

/** The upstream validateSheetName shape (1-31 chars, no \ / ? * [ ] :, no
 *  leading/trailing apostrophe). */
export function sheetNameShapeOK(name: string): boolean {
  if (name.length === 0 || name.length > 31) return false;
  if (/[\\/?*[\]:]/.test(name)) return false;
  return !name.startsWith("'") && !name.endsWith("'");
}

export type XlsxOutlineAction = "group" | "ungroup" | "clear";

/** Seed the column outline map from the file's `<col>` metadata once, at
 *  load (the streamed row chunks seed rows the same way). Session group edits
 *  own an entry once it exists, so a later read only fills gaps. */
export function seedColumnOutline(state: LazyWorkbookState | null): void {
  if (!state) return;
  for (const sheet of state.file.sheets) {
    for (const span of sheet.columnWidths) {
      if (span.outlineLevel === undefined && !span.collapsed) continue;
      const outline = state.outline.get(sheet.id) ?? { rows: new Map(), cols: new Map() };
      state.outline.set(sheet.id, outline);
      for (let column = span.startColumn; column <= span.endColumn; column += 1) {
        if (outline.cols.has(column)) continue;
        outline.cols.set(column, { level: span.outlineLevel ?? 0, collapsed: span.collapsed ?? false });
      }
    }
  }
}

/** Row outline levels from the file (the host's `rowOutline` on each sheet,
 *  UNI-953 F2). The vendored loader seeds a row only when its range streams,
 *  so an outline action, or its undo, over rows not yet on screen read level
 *  0 and flattened the file's groups; seeding every grouped row at open, as
 *  the columns are, makes the action raise from the file's level. Session
 *  entries are never overridden, and the loader's later per-row seed skips
 *  the rows this already holds. */
export function seedRowOutline(state: LazyWorkbookState | null): void {
  if (!state) return;
  for (const sheet of state.file.sheets) {
    const rows = (sheet as { rowOutline?: unknown }).rowOutline;
    if (!Array.isArray(rows)) continue;
    for (const entry of rows as Array<{ row?: unknown; outlineLevel?: unknown; collapsed?: unknown }>) {
      if (typeof entry?.row !== "number" || !Number.isInteger(entry.row) || entry.row < 0) continue;
      const level = typeof entry.outlineLevel === "number" && Number.isInteger(entry.outlineLevel)
        ? Math.min(7, Math.max(0, entry.outlineLevel)) : 0;
      const collapsed = entry.collapsed === true;
      if (level === 0 && !collapsed) continue;
      const outline = state.outline.get(sheet.id) ?? { rows: new Map(), cols: new Map() };
      state.outline.set(sheet.id, outline);
      if (!outline.rows.has(entry.row)) outline.rows.set(entry.row, { level, collapsed });
    }
  }
}

/** The pinned build's `sheet.command.set-col-is-auto-width` handler emits no
 *  mutation (no interceptor in any bundled package serves its id), so the
 *  toolbar's "use default column width" reset journals the sheet-default
 *  size itself — a set-col-size op with a null size, the shape the row
 *  auto-height mutation produces. Records one op for the whole span. */
export function applyColumnDefaultWidth(
  state: LazyWorkbookState | null,
  sheetId: string,
  start: number,
  end: number,
): XlsxRendererStructuralEdit[] {
  const sheet = state?.file.sheets.find((candidate) => candidate.id === sheetId);
  if (!state || !sheet) return [];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return [];
  const structural: StructuralJournalOp = { kind: "set-col-size", start, end, size: null };
  recordStructuralOp(state.editJournal, sheetId, structural, sheet.name);
  return [{ sheetId, structural }];
}

/** Whether an outline action can address this span: a known sheet and an
 *  ordered, non-negative integer span. A valid span can still change nothing
 *  (ungroup at level 0, group at level 7); callers tell that apart from a
 *  refused one with this. */
export function validOutlineSpan(state: LazyWorkbookState | null, sheetId: string, start: number, end: number): boolean {
  if (!state || !state.file.sheets.some((sheet) => sheet.id === sheetId)) return false;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
}

/** Group/ungroup/clear for a selection span. Outline levels have no Univer
 *  model (and no command to undo — genoffice parity), so the controller's
 *  outline commands journal directly here; contiguous runs of equal levels
 *  shift by one, clamped 0-7, and a clear writes level 0 for the span. */
export function applyOutlineAction(
  state: LazyWorkbookState | null,
  sheetId: string,
  axis: "rows" | "cols",
  start: number,
  end: number,
  action: XlsxOutlineAction,
): XlsxRendererStructuralEdit[] {
  if (!state || !validOutlineSpan(state, sheetId, start, end)) return [];
  const outline = state.outline.get(sheetId) ?? { rows: new Map(), cols: new Map() };
  state.outline.set(sheetId, outline);
  const kind = axis === "rows" ? ("set-rows-outline" as const) : ("set-cols-outline" as const);
  const entries = axis === "rows" ? outline.rows : outline.cols;
  const edits: XlsxRendererStructuralEdit[] = [];
  const sheetName = state.file.sheets.find((sheet) => sheet.id === sheetId)?.name;
  const record = (structural: Extract<StructuralJournalOp, { level: number }>): void => {
    recordStructuralOp(state.editJournal, sheetId, structural, sheetName);
    edits.push({ sheetId, structural });
  };
  const apply = (from: number, to: number, level: number): void => {
    for (let line = from; line <= to; line += 1) {
      entries.set(line, { level, collapsed: entries.get(line)?.collapsed ?? false });
    }
    record({ kind, start: from, end: to, level });
  };
  if (action === "clear") {
    apply(start, end, 0);
    return edits;
  }
  const delta = action === "group" ? 1 : -1;
  let runStart = start;
  let runLevel = entries.get(start)?.level ?? 0;
  let touched = false;
  const closeRun = (runEnd: number): void => {
    const level = Math.min(7, Math.max(0, runLevel + delta));
    if (level === runLevel) return;
    touched = true;
    apply(runStart, runEnd, level);
  };
  for (let line = start + 1; line <= end; line += 1) {
    const level = entries.get(line)?.level ?? 0;
    if (level !== runLevel) {
      closeRun(line - 1);
      runStart = line;
      runLevel = level;
    }
  }
  closeRun(end);
  return touched ? edits : [];
}

/** The outline group Show / Hide Detail acts on (Excel): when the line
 *  before `line` sits deeper, `line` is the summary of the group above it and
 *  that group is the target (summary rows below their detail, Excel's
 *  default); otherwise a grouped line targets the run around it at or below
 *  its own level. Null when the line is in no group. */
export function outlineDetailSpan(
  state: LazyWorkbookState | null,
  sheetId: string,
  axis: "rows" | "cols",
  line: number,
): { start: number; end: number } | null {
  if (!Number.isInteger(line) || line < 0) return null;
  const outline = state?.outline.get(sheetId);
  const entries = axis === "rows" ? outline?.rows : outline?.cols;
  if (!entries) return null;
  const level = (at: number): number => entries.get(at)?.level ?? 0;
  const own = level(line);
  if (line > 0 && level(line - 1) > own) {
    let start = line - 1;
    while (start > 0 && level(start - 1) > own) start -= 1;
    return { start, end: line - 1 };
  }
  if (own === 0) return null;
  let start = line;
  let end = line;
  while (start > 0 && level(start - 1) >= own) start -= 1;
  // Ends at the first shallower line; unseeded lines read level 0 < own.
  while (level(end + 1) >= own) end += 1;
  return { start, end };
}

/** Writes Excel's collapsed flag on a group's summary line, so a reopened file
 *  shows "+" (Hide Detail) or "-" (Show Detail) beside it. Journalled as an
 *  outline op at the line's own level with an explicit collapsed, so the
 *  level survives and the flag is cleared, not just left alone. A line already
 *  in that state, or past the grid, journals nothing. */
export function applyOutlineCollapse(
  state: LazyWorkbookState | null,
  sheetId: string,
  axis: "rows" | "cols",
  line: number,
  collapsed: boolean,
): XlsxRendererStructuralEdit[] {
  if (!state || !validOutlineSpan(state, sheetId, line, line)) return [];
  if (line >= (axis === "rows" ? 1_048_576 : 16_384)) return [];
  const outline = state.outline.get(sheetId) ?? { rows: new Map(), cols: new Map() };
  state.outline.set(sheetId, outline);
  const entries = axis === "rows" ? outline.rows : outline.cols;
  const level = entries.get(line)?.level ?? 0;
  if ((entries.get(line)?.collapsed ?? false) === collapsed) return [];
  entries.set(line, { level, collapsed });
  const structural: Extract<StructuralJournalOp, { level: number }> =
    { kind: axis === "rows" ? "set-rows-outline" : "set-cols-outline", start: line, end: line, level, collapsed };
  recordStructuralOp(state.editJournal, sheetId, structural, state.file.sheets.find((sheet) => sheet.id === sheetId)?.name);
  return [{ sheetId, structural }];
}

/** The Univer undo/redo entry of a collapsed-flag change: undo and redo replay
 *  the allowlisted collapse command with the opposite and the new value. */
export function outlineCollapseHistoryItem(
  unitId: string,
  sheetId: string,
  axis: "rows" | "cols",
  line: number,
  collapsed: boolean,
): { unitID: string; undoMutations: XlsxOutlineCollapseStep[]; redoMutations: XlsxOutlineCollapseStep[] } {
  const step = (value: boolean): XlsxOutlineCollapseStep => ({
    id: "uniwork.command.set-outline-collapsed",
    params: { subUnitId: sheetId, axis, start: line, end: line, collapsed: value, history: false },
  });
  return { unitID: unitId, undoMutations: [step(!collapsed)], redoMutations: [step(collapsed)] };
}

export interface XlsxOutlineCollapseStep {
  id: "uniwork.command.set-outline-collapsed";
  params: { subUnitId: string; axis: "rows" | "cols"; start: number; end: number; collapsed: boolean; history: false };
}

/** Outline levels follow their lines through a row/column insert or removal
 *  (the journal shifts its cells the same way). Inserted lines get an explicit
 *  level 0, as the saved file will (the gateway writes no level for a new
 *  row/col), so a later file seed never lends them a shifted neighbour's. */
function shiftOutlineLines(
  state: LazyWorkbookState,
  sheetId: string,
  kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols",
  index: number,
  count: number,
): void {
  const outline = state.outline.get(sheetId);
  if (!outline) return;
  const entries = kind.endsWith("rows") ? outline.rows : outline.cols;
  const insert = kind.startsWith("insert");
  const shifted = new Map<number, { level: number; collapsed: boolean }>();
  for (const [line, entry] of entries) {
    if (line < index) shifted.set(line, entry);
    else if (insert) shifted.set(line + count, entry);
    else if (line >= index + count) shifted.set(line - count, entry);
  }
  if (insert) {
    for (let line = index; line < index + count; line += 1) shifted.set(line, { level: 0, collapsed: false });
  }
  entries.clear();
  for (const [line, entry] of shifted) entries.set(line, entry);
}

/** The outline level of every line of the span (0 when none), read before an
 *  outline action so its undo can restore them. */
export function outlineLevels(
  state: LazyWorkbookState | null,
  sheetId: string,
  axis: "rows" | "cols",
  start: number,
  end: number,
): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return [];
  const outline = state?.outline.get(sheetId);
  const entries = axis === "rows" ? outline?.rows : outline?.cols;
  return Array.from({ length: end - start + 1 }, (_, offset) => entries?.get(start + offset)?.level ?? 0);
}

/** One step of an outline undo/redo entry: the same uniwork outline command,
 *  marked `history: false` so replaying it pushes no new undo entry. */
export interface XlsxOutlineHistoryStep {
  id: string;
  params: { subUnitId: string; start: number; end: number; action: XlsxOutlineAction; history: false };
}

/** The Univer undo/redo entry for an outline action that ran over `start..end`
 *  with `before` the levels it found. Undo replays allowed outline commands
 *  (clear the span, then one group per level over the lines that were at least
 *  that deep), so the restoration is journalled like any outline edit and
 *  passes the command policy; redo replays the action itself. Pushed for the
 *  workbook unit, it joins an open executeAsOneStep batch. */
export function outlineHistoryItem(
  unitId: string,
  sheetId: string,
  axis: "rows" | "cols",
  start: number,
  end: number,
  action: XlsxOutlineAction,
  before: readonly number[],
): { unitID: string; undoMutations: XlsxOutlineHistoryStep[]; redoMutations: XlsxOutlineHistoryStep[] } {
  const id = axis === "rows" ? "uniwork.command.set-rows-outline" : "uniwork.command.set-cols-outline";
  const step = (from: number, to: number, stepAction: XlsxOutlineAction): XlsxOutlineHistoryStep =>
    ({ id, params: { subUnitId: sheetId, start: from, end: to, action: stepAction, history: false } });
  const undoMutations = [step(start, end, "clear")];
  const deepest = Math.max(0, ...before);
  for (let level = 1; level <= deepest; level += 1) {
    let runStart = -1;
    before.forEach((lineLevel, offset) => {
      if (lineLevel >= level && runStart < 0) runStart = offset;
      if (lineLevel < level && runStart >= 0) {
        undoMutations.push(step(start + runStart, start + offset - 1, "group"));
        runStart = -1;
      }
    });
    if (runStart >= 0) undoMutations.push(step(start + runStart, start + before.length - 1, "group"));
  }
  return { unitID: unitId, undoMutations, redoMutations: [step(start, end, action)] };
}

// ── filter capture (B4: auto filter / advanced filter) ─────────────────────
//
// The pinned filter preset keeps one FilterModel per sheet; every mutation in
// FILTER_MUTATIONS changes it. The save snapshot is declarative (a whole-sheet
// SheetFilterState), so the capture reads the live model back at mutation time
// and emits one snapshot — the plan folds last-write-per-sheet. The pinned
// plugin's ref-range handler re-runs `set-filter-range` after an insert/remove
// rows/cols command, so a structural shift re-snapshots the filter at its
// post-shift coordinates. Color criteria have no OOXML mapping in the vendored
// writer (serializeFilterColumn only writes values/customs): the snapshot
// refuses with the same message the vendored save path used, rather than
// silently dropping criteria.

/** The last visibility range seen for a sheet's filter this session. A removed
 *  filter has no live model left to read, and a session-created filter has no
 *  file origin, so the clear snapshot falls back to this range. */
const lastFilterRanges = new WeakMap<LazyWorkbookState, Map<string, AxisRange>>();

/** Snapshot one sheet's live filter model. `filter: null` is a clear: the
 *  filter was removed, and the visibility range is the file origin's range (or
 *  the last range this session saw). Returns null when no filter ever existed
 *  on the sheet, so nothing needs emitting. Throws when the filter carries
 *  color criteria — unsaveable, exactly like the vendored `collectFilterStates`
 *  path (`appColorFiltersUnsaveable`). */
export function snapshotSheetFilter(
  state: LazyWorkbookState,
  sheetId: string,
  worksheet: UniverWorksheet,
): { filter: XlsxRendererFilterSetState | null; hiddenRows: number[]; visibilityRange: AxisRange } | null {
  const filter = worksheet.getFilter();
  const origin = state.filterOrigins.get(sheetId);
  if (!filter) {
    const visibilityRange = origin?.range ?? lastFilterRanges.get(state)?.get(sheetId);
    if (!visibilityRange) return null;
    return { filter: null, hiddenRows: [], visibilityRange: { ...visibilityRange } };
  }
  const raw = filter.getRange().getRange();
  const range: AxisRange = {
    startRow: raw.startRow, endRow: raw.endRow, startColumn: raw.startColumn, endColumn: raw.endColumn,
  };
  const columns: XlsxRendererFilterColumnState[] = [];
  for (let column = range.startColumn; column <= range.endColumn; column += 1) {
    const criteria = filter.getColumnFilterCriteria(column);
    if (!criteria) continue;
    if (criteria.colorFilters) throw new Error(t("appColorFiltersUnsaveable"));
    if (!criteria.filters && !criteria.customFilters) continue;
    const customFilters = criteria.customFilters;
    columns.push({
      colId: column - range.startColumn,
      ...(criteria.filters?.filters ? { values: [...criteria.filters.filters] } : {}),
      ...(criteria.filters?.blank ? { blank: true } : {}),
      ...(customFilters
        ? {
            customs: {
              ...(customFilters.and ? { and: true } : {}),
              filters: customFilters.customFilters.map((custom) => ({
                val: custom.val,
                ...(custom.operator ? { operator: custom.operator } : {}),
              })),
            },
          }
        : {}),
    });
  }
  // The visibility span is the union of the filter range and its file origin:
  // the save unhides every row inside it that is not filtered out, so a filter
  // that shrank must keep unhiding the rows the origin covered.
  const visibilityRange = origin
    ? {
        startRow: Math.min(range.startRow, origin.range.startRow),
        endRow: Math.max(range.endRow, origin.range.endRow),
        startColumn: Math.min(range.startColumn, origin.range.startColumn),
        endColumn: Math.max(range.endColumn, origin.range.endColumn),
      }
    : { ...range };
  rememberFilterRange(state, sheetId, visibilityRange);
  // The filter model lists absolute row indexes; only rows inside the data
  // span are meaningful to the writer, but extras are ignored there.
  const hiddenRows = [...filter.getFilteredOutRows()].sort((left, right) => left - right);
  return {
    filter: { range, columns },
    hiddenRows: hiddenRows.filter((row) => Number.isInteger(row) && row >= 0),
    visibilityRange,
  };
}

function rememberFilterRange(state: LazyWorkbookState, sheetId: string, range: AxisRange): void {
  const ranges = lastFilterRanges.get(state) ?? new Map<string, AxisRange>();
  ranges.set(sheetId, range);
  lastFilterRanges.set(state, ranges);
}

/** Ingest one filter mutation into a whole-sheet filter edit. The worksheet
 *  getter resolves the mutated sheet's live filter model (the controller reads
 *  it off the mounted workbook); a mutation for another workbook, an unknown
 *  sheet, or with the journal suppressed emits nothing. Throws on color
 *  criteria (see snapshotSheetFilter) — the caller surfaces the message. */
export function ingestFilterMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  worksheetFor: (sheetId: string) => UniverWorksheet | null,
  suppressed = false,
): XlsxRendererFilterEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !FILTER_MUTATIONS.has(event.id)) return [];
  const params = event.params as { unitId?: string; subUnitId?: string } | undefined;
  const sheetId = params?.subUnitId;
  const liveSheets = liveSessionSheets(state);
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSheets.some((sheet) => sheet.id === sheetId)) return [];
  const worksheet = worksheetFor(sheetId);
  if (!worksheet) return [];
  recordFilterChange(state.editJournal, sheetId);
  const snapshot = snapshotSheetFilter(state, sheetId, worksheet);
  if (!snapshot) return [];
  return [
    {
      sheetId,
      filter: snapshot.filter,
      hiddenRows: snapshot.hiddenRows,
      visibilityRange: snapshot.visibilityRange,
    },
  ];
}


/** The pinned note mutations: update-note sets/replaces a note,
 *  remove-note deletes it. Either way the whole-sheet note set is snapshotted
 *  from the live model (same recipe as the vendored collectNoteStates). */
const NOTE_MUTATIONS = new Set(["sheet.mutation.update-note", "sheet.mutation.remove-note"]);

/** Ingest one note mutation into a whole-sheet note edit. The live note text
 *  carries an "Author:\n" first line when it came from the file; splitting it
 *  back keeps the author column on round-trip. */
export function ingestNoteMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  worksheetFor: (sheetId: string) => UniverWorksheet | null,
  suppressed = false,
): XlsxRendererNotesEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !NOTE_MUTATIONS.has(event.id)) return [];
  const params = event.params as { unitId?: string; subUnitId?: string } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return [];
  const worksheet = worksheetFor(sheetId);
  if (!worksheet) return [];
  recordNoteChange(state.editJournal, sheetId);
  const notes = worksheet.getNotes().map((note) => {
    const split = /^([^\n]{1,60}):\n([\s\S]*)$/.exec(note.note);
    return { row: note.row, column: note.col, author: split?.[1] ?? "", text: split?.[2] ?? note.note };
  });
  return [{ sheetId, notes }];
}

/** Record one hyperlink change at a cell (mirrors applyAiHyperlink's journal
 *  write) and return the renderer edit for the host to persist. */
export function hyperlinkEdit(
  state: LazyWorkbookState,
  sheetId: string,
  row: number,
  column: number,
  target: string | null,
): XlsxRendererHyperlinkEdit {
  recordHyperlinkEdit(state.editJournal, sheetId, row, column, target);
  return { sheetId, row, column, target };
}


// ── sort capture (A7 / FIX-SORT) ─────────────────────────────────────────────
//
// The pinned sort path is sheet.command.sort-range -> sheet.command.reorder-range
// -> sheet.mutation.reorder-range, which reorders whole rows in place. The
// vendored renderer already captures that mutation with journalRangeSnapshot
// (univer-sync.ts), which journals every cell of the sorted range as set_cell
// edits so the save writes exactly what the screen shows. This wrapper invokes
// that capture and diffs the journal afterwards, because the controller's edit
// channel emits the CHANGED cells (the journal alone never reaches onEdits).
//
// The capture is injected by the controller rather than imported here: the
// vendored snapshot lives in univer-sync, which the shim's lighter test bundles
// (scripts/office/xlsx-renderer-edits.test.mjs) do not load.

/** The vendored range-snapshot capture (journalRangeSnapshot), injected by the
 *  controller so this module stays free of the heavy univer-sync import. */
export type SortJournalCapture = (
  state: LazyWorkbookState,
  sheetId: string,
  range: AxisRange,
  order?: Readonly<Record<number, number>>,
) => void;

/** Ingest one reorder-range (sort) mutation: run the vendored capture over the
 *  sorted range, then return the cells whose journal entries it changed, so the
 *  controller emits them on the edit channel and a save persists the new row
 *  order. */
export function ingestSortMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  capture: SortJournalCapture,
  suppressed = false,
): XlsxRendererCellEdit[] {
  if (!state || suppressed || event.options?.fromFormula || event.id !== REORDER_RANGE_MUTATION) return [];
  const params = event.params as {
    unitId?: string; subUnitId?: string; range?: AxisRange; order?: Record<number, number>;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return [];
  const range = params.range;
  if (!range || ![range.startRow, range.endRow, range.startColumn, range.endColumn]
    .every((value) => Number.isInteger(value) && value >= 0)) return [];
  const before = new Map(state.editJournal.cells.get(sheetId));
  capture(state, sheetId, range, params.order);
  const after = state.editJournal.cells.get(sheetId);
  if (!after) return [];
  const changed: XlsxRendererCellEdit[] = [];
  for (const [key, entry] of after) {
    if (JSON.stringify(before.get(key)) === JSON.stringify(entry)) continue;
    changed.push({
      sheetId, row: entry.row, column: entry.column,
      writeValue: entry.hasValue, value: entry.value,
      ...(entry.formula === undefined ? {} : { formula: entry.formula }),
      ...(entry.style === undefined ? {} : { style: { ...entry.style } }),
      ...(entry.styleReset ? { styleReset: true } : {}),
    });
  }
  return changed;
}
