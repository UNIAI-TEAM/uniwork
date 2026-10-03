import {
  recordSetNumfmt,
  recordSetRangeValues,
  recordSheetDuplicate,
  recordSheetHidden,
  recordSheetInsert,
  recordSheetOrderChange,
  recordSheetRemove,
  recordSheetRename,
  recordStructuralOp,
  type StructuralJournalOp,
} from "../../upstream/apps/sheets/src/renderer/edit-journal";
import { pixelsToCharacterWidth } from "../../upstream/apps/sheets/src/renderer/app-constants";
import type { SharedFormulaResolver } from "../../upstream/apps/sheets/src/renderer/shared-formula-journal";
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import type { IExecutionOptions } from "@univerjs/core";

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

/** Everything the renderer's edit channel can emit. */
export type XlsxRendererEdit = XlsxRendererCellEdit | XlsxRendererStructuralEdit | XlsxRendererSheetEdit;

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
  if (!state || !state.file.sheets.some((sheet) => sheet.id === sheetId)) return [];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return [];
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
