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
    [key: string]: unknown;
  }>;
  styles: unknown[];
  [key: string]: unknown;
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
  onMessage?: (message: string) => void;
  onDirty?: () => void;
  onSelectionChange?: (selection: XlsxRendererSelection | null) => void;
}

export interface XlsxRendererJournal {
  readonly cells: Map<string, Map<string, unknown>>;
  readonly structuralOps: Map<string, unknown[]>;
  [key: string]: unknown;
}

export interface XlsxRendererHandle {
  loadWorkbook(file: RendererWorkbookFile, options?: { initialSheetId?: string }): Promise<void>;
  refreshViewport(): void;
  revealCell(sheetId: string, row: number, column: number): Promise<void>;
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
  getJournal(): XlsxRendererJournal;
  dispose(): void;
}

export function createXlsxRenderer(options: XlsxRendererOptions): XlsxRendererHandle;
