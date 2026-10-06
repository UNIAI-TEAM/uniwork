// G3-05c (UNI-824) - typed surface of the built dist/xlsx-renderer.mjs
// artifact. Structural on purpose: the vendored payload shapes are the
// genoffice workbook contract, mirrored here so the shared XlsxEditor can
// consume the artifact without reading the vendored tree.

export const XLSX_RENDERER_STYLE_ELEMENT_ID: string;
/** Mounts the repackaged Univer stylesheet (scoped to `.xlsx-surface`) once per document. */
export function installXlsxRendererStyles(doc?: Document): void;

export interface RendererCellState {
  value: string | number | boolean | null;
  formula?: string;
  rawValue?: string | number | boolean | null;
}

export interface RendererRangeCell {
  row: number;
  column: number;
  value: string | number | boolean | null;
  formula?: string;
  arrayRef?: string;
  styleIndex?: number;
  rich?: unknown[];
}

export interface RendererRangeRow {
  row: number;
  height?: number;
  customHeight?: boolean;
  hidden: boolean;
  outlineLevel?: number;
  collapsed?: boolean;
  styleIndex?: number;
}

export interface RendererRangeResult {
  cells: RendererRangeCell[];
  rows: RendererRangeRow[];
  merges: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  hyperlinks: Array<{ row: number; column: number; target: string }>;
  conditionalRules?: unknown[];
  autoFilter?: unknown;
  autoFilterColumns?: unknown[];
  dataValidations?: unknown[];
  sheetProtection?: { protected: boolean; hasPassword: boolean } | null;
  protectedRanges?: unknown[];
  pageSetup?: unknown;
  indexedThroughRow?: number | null;
  [key: string]: unknown;
}

export interface RendererWorkbookFile {
  sessionId: string;
  name: string;
  sha256: string;
  fileBytes?: number;
  sheets: Array<{
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
    hidden?: boolean;
    showFormulas?: boolean;
  }>;
  styles: unknown[];
}

export interface XlsxRendererHost {
  readRange(input: {
    sessionId: string;
    sheetId: string;
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  }): Promise<RendererRangeResult>;
  readFormulas?(input: { sessionId: string; sheetId: string }): Promise<unknown>;
  recalcWorkbook?(input: unknown): Promise<unknown>;
}

export interface XlsxRendererSelection {
  sheetId: string;
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
}

export interface XlsxRendererOptions {
  container: HTMLElement;
  host: XlsxRendererHost;
  dark?: boolean;
  readOnly?: boolean;
  onMessage?: (message: string) => void;
  onDirty?: () => void;
  onEdits?: (edits: XlsxRendererEdit[]) => void;
  onSelectionChange?: (selection: XlsxRendererSelection | null) => void;
}

export interface XlsxRendererCellEdit {
  sheetId: string;
  /** Live sheet name, stamped only when it differs from the host file's (a
   *  session rename or an added sheet); absent otherwise. */
  sheetName?: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

/** One row/column or merge journal op the renderer's structural journal
 *  emits. The vendored StructuralJournalOp subset this lane binds: no
 *  move-rows, no set-col-style. Positions are 0-based; row sizes are points,
 *  column sizes character width; a null size resets the sheet default. Merge
 *  ops carry their 0-based rectangle and never shift coordinates. */
export type XlsxRendererStructuralJournalOp =
  | { kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols"; index: number; count: number }
  | { kind: "set-row-size" | "set-col-size"; start: number; end: number; size: number | null }
  | { kind: "set-rows-hidden" | "set-cols-hidden"; start: number; end: number; hidden: boolean }
  | { kind: "set-rows-outline" | "set-cols-outline"; start: number; end: number; level: number; collapsed?: boolean }
  | {
      kind: "merge-cells" | "unmerge-cells";
      range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
    };

export interface XlsxRendererStructuralEdit {
  sheetId: string;
  /** Live sheet name (see XlsxRendererCellEdit.sheetName). */
  sheetName?: string;
  structural: XlsxRendererStructuralJournalOp;
}

/** One worksheet-level edit (B3). Per kind: add/duplicate name the NEW sheet
 *  (`index` = final tab position; duplicate also names its source), remove
 *  names the removed sheet, rename carries the PRE-mutation name in
 *  `sheetName` and the new one in `newName`, reorder/hide name the unchanged
 *  sheet. */
export interface XlsxRendererSheetEdit {
  sheetId: string;
  sheetName: string;
  sheetOp: XlsxRendererSheetJournalOp;
}

export type XlsxRendererSheetJournalOp =
  | { kind: "add-sheet"; index: number }
  | { kind: "duplicate-sheet"; sourceSheetId: string; sourceName: string; index: number }
  | { kind: "remove-sheet" }
  | { kind: "rename-sheet"; newName: string }
  | { kind: "set-sheet-hidden"; hidden: boolean }
  | { kind: "reorder-sheet"; index: number };

/** One custom filter condition (the upstream FilterColumnState.customs entry):
 *  a value and an optional OOXML comparison operator (absent = equality). */
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

/** The declarative filter snapshot of one sheet. */
export interface XlsxRendererFilterSetState {
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  columns: XlsxRendererFilterColumnState[];
}

/** One filter edit (B4): the whole-sheet snapshot, or a clear (a removed
 *  filter) with only the visibility range the gateway unhides. `sheetName` is
 *  stamped when it differs from the host file's. */
export interface XlsxRendererFilterEdit {
  sheetId: string;
  sheetName?: string;
  filter: XlsxRendererFilterSetState | null;
  hiddenRows: number[];
  visibilityRange: { startRow: number; endRow: number; startColumn: number; endColumn: number };
}

/** Every edit the renderer's onEdits channel can emit. */
export interface XlsxRendererTableEdit {
  sheetId: string;
  table: { area: { startRow: number; endRow: number; startColumn: number; endColumn: number }; name: string; columnNames: string[]; style?: string; bandedRows: boolean } | null;
  name: string;
}

export type XlsxRendererEdit =
  | XlsxRendererCellEdit
  | XlsxRendererStructuralEdit
  | XlsxRendererSheetEdit
  | XlsxRendererFilterEdit
  | XlsxRendererTableEdit;

export interface XlsxRendererFontMapping {
  declared: string;
  used: string | null;
  source: "local" | "carlito" | "browser-fallback";
}

export interface XlsxRendererJournal {
  readonly cells: Map<string, Map<string, unknown>>;
  readonly structuralOps: Map<string, unknown[]>;
  [key: string]: unknown;
}

/** The cheap active-selection style read (alignment values are the pinned
 *  Univer style numbers: horizontal 1=left/2=center/3=right, vertical
 *  1=top/2=middle/3=bottom; rotation is degrees). */
export interface XlsxRendererFormatState {
  readonly fontFamily: string | null;
  readonly fontSize: number | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly textColor: string | null;
  readonly fillColor: string | null;
  readonly horizontalAlign: number | null;
  readonly verticalAlign: number | null;
  readonly wrap: boolean;
  readonly textRotation: number | null;
}

/** One live sheet as the tab strip reads it (order = tab order). */
export interface XlsxRendererSheetInfo {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
}

export interface XlsxRendererHandle {
  loadWorkbook(file: RendererWorkbookFile, options?: { initialSheetId?: string }): Promise<void>;
  refreshViewport(): void;
  revealCell(sheetId: string, row: number, column: number): Promise<void>;
  setCellText(sheetId: string, row: number, column: number, text: string): void;
  commitEdit(): Promise<void>;
  selectSheet(sheetId: string): void;
  setNumberFormat(pattern: string): void;
  /** Run an allowlisted Univer command against the active selection; false
   *  when the mount is read-only, there is no active range, or the command
   *  policy cancels the command. */
  executeCommand(id: string, params?: unknown): Promise<boolean>;
  /** The active range's composed style, or null without an active range. */
  getActiveFormatState(): XlsxRendererFormatState | null;
  /** The live sheet list in tab order (rename/insert/remove/reorder as they
   *  happen). */
  getSheets(): readonly XlsxRendererSheetInfo[];
  setDarkMode(dark: boolean): void;
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
  getFontMappings(): readonly XlsxRendererFontMapping[];
  getJournal(): XlsxRendererJournal;
  dispose(): void;
}

export function createXlsxRenderer(options: XlsxRendererOptions): XlsxRendererHandle;
