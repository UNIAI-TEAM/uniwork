// XLSX engine seam — structural types the adapter and the service handlers
// read/write, plus the native recalculation port.
//
// Real upstream signatures this seam mirrors (genoffice pinned at
// 09485f884dc845cf3bf27fb7edfe489f9d457aad — vendored, patched per
// packages/office-upstream/patches/0001, imported ONLY through a built
// artifact, never from the vendored source path):
//   readBasicWorkbook(buffer: Buffer) => Promise<ImportedXlsx>
//       packages/xlsx-gateway/src/gateway/xlsx-gateway.ts:494
//   inventoryXlsx(buffer: Buffer) => Promise<PackageEntry[]>          :525
//   applyCellEditsToXlsx(source, edits, structuralOps, chartEdits,
//       sheetPlan, filterStates, hyperlinkEdits, cfStates, dvStates,
//       sheetProtections, definedNamesState, pageSetupStates,
//       noteStates, formulaValues) => Promise<XlsxMutation>           :579
//   planCellEditsToXlsx(source, edits, ...) => Promise<MutationPlan>  :690
//   assertOnlyTouchedEntriesChanged(mutation) => void                 :1685
//   createBufferEntrySource(buffer) => Promise<EntrySource>           :456
//
// Native recalculation seam (this package declares it; only src/node
// implements it — there is no browser/WASM recalc path):
//   recalc_cells {path, edits:[{sheet,row,column,input}], reads:[{sheet,
//       range:{startRow,endRow,startColumn,endColumn}}]}
//     => {cells:[{sheet,row,column,formatted,number?,isError,isFormula}],
//         cached}
//       apps/sheets/native/xlsx-engine/src/main.rs:84, recalc.rs:36-75
//   cancel {targetRequestId}                                          main.rs:55
//   request envelope {version:1, requestId, ...command}; response
//     {version, requestId, ok, result|error:{code,message}}           main.rs:92-116
//
// Coordinates on every wire surface are 0-based (IronCalc internally works
// 1-based; the sidecar translates). CellState.formula carries the leading
// "=" — the gateway strips it when it writes <f>.

export type XlsxCellScalar = string | number | boolean | null;

/** Upstream CellState (xlsx-gateway domain/workbook.types.ts:17). `formula`
 *  holds the leading "=" exactly as parseWorksheetCells produces it. */
export interface XlsxCellState {
  readonly value: XlsxCellScalar;
  readonly formula?: string | undefined;
  readonly rawValue?: XlsxCellScalar | undefined;
}

/** Upstream WorksheetState (workbook.types.ts:45): `cells` keyed by A1
 *  address; `id` is the gateway's `sheet-<sheetId>` token. */
export interface XlsxWorksheet {
  readonly id: string;
  readonly name: string;
  readonly cells: Readonly<Record<string, XlsxCellState>>;
}

export interface XlsxWorkbookSnapshot {
  readonly revision: number;
  readonly sheets: readonly XlsxWorksheet[];
}

/**
 * Runtime guard for the JSON snapshot crossing the service/browser boundary.
 * The gateway is the producer, but this check keeps a malformed or future
 * gateway result from becoming an unbounded/ambiguous document model in the
 * web host. Keep the accepted values aligned with the wire CellState scalar
 * type; formula and rawValue are optional strings/scalars respectively.
 */
export function isXlsxWorkbookSnapshot(value: unknown): value is XlsxWorkbookSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as { revision?: unknown; sheets?: unknown };
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0 || !Array.isArray(snapshot.sheets)) {
    return false;
  }
  const isScalar = (candidate: unknown): candidate is XlsxCellScalar =>
    candidate === null ||
    typeof candidate === "string" ||
    typeof candidate === "boolean" ||
    (typeof candidate === "number" && Number.isFinite(candidate));
  return snapshot.sheets.length > 0 && snapshot.sheets.every((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const sheet = candidate as { id?: unknown; name?: unknown; cells?: unknown };
    if (typeof sheet.id !== "string" || sheet.id.length === 0 || typeof sheet.name !== "string" || sheet.name.length === 0) {
      return false;
    }
    if (!sheet.cells || typeof sheet.cells !== "object" || Array.isArray(sheet.cells)) return false;
    return Object.values(sheet.cells as Record<string, unknown>).every((cell) => {
      if (!cell || typeof cell !== "object") return false;
      const state = cell as { value?: unknown; formula?: unknown; rawValue?: unknown };
      if (!isScalar(state.value)) return false;
      if (state.formula !== undefined && typeof state.formula !== "string") return false;
      return state.rawValue === undefined || isScalar(state.rawValue);
    });
  });
}

/** Upstream ImportedXlsx (xlsx-gateway.ts:194). */
export interface XlsxImported {
  readonly snapshot: XlsxWorkbookSnapshot;
  readonly sheetNamesById: Readonly<Record<string, string>>;
}

/** Upstream CellEdit (xlsx-gateway.ts:199). `style` stays opaque here: the
 *  gateway owns the field vocabulary (WorkbookStyleEdit) and rejects unknown
 *  keys — the seam just carries the object the caller parsed. */
export interface XlsxCellEdit {
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
  /** false = style-only edit; the stored cell content stays untouched. */
  readonly writeValue: boolean;
  readonly cell: XlsxCellState;
  readonly style?: Record<string, unknown> | undefined;
  readonly styleReset?: boolean | undefined;
}

/** Upstream FormulaCachedValue (xlsx-gateway.ts:183): `{error}` is an
 *  engine-typed error; a plain string is text even when it spells one. */
export type XlsxFormulaValue = string | number | boolean | null | { readonly error: string };

export interface XlsxSheetFormulaValues {
  readonly sheetName: string;
  readonly cells: readonly {
    readonly row: number;
    readonly column: number;
    readonly value: XlsxFormulaValue;
  }[];
}

export interface XlsxPackageEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

/** Upstream XlsxMutation (xlsx-gateway.ts:130). `buffer` is the assembled
 *  output package; the entry ledgers are the preservation oracle's input. */
export interface XlsxMutation {
  readonly buffer: Uint8Array;
  readonly touchedEntries: readonly string[];
  readonly removedEntries: readonly string[];
  readonly addedEntries: readonly string[];
  readonly beforeEntries: readonly XlsxPackageEntry[];
  readonly afterEntries: readonly XlsxPackageEntry[];
}

/** The vendored gateway functions this lane consumes (bound via vendor.ts).
 *  Everything takes/returns Uint8Array; vendor.ts bridges Buffer where the
 *  upstream signature names it. */
export interface XlsxGatewayFunctions {
  /** Parse workbook.xml + worksheet cells into the snapshot (no styles,
   *  no shared-formula expansion — readBasicWorkbook is the "basic" parse). */
  readWorkbook(bytes: Uint8Array): Promise<XlsxImported>;
  /** Sorted package inventory: path, uncompressed size, sha256. */
  inventory(bytes: Uint8Array): Promise<readonly XlsxPackageEntry[]>;
  /** Raw text of one package entry (workbook.xml, a worksheet part) or null
   *  when absent — the probe's feature-flag source. */
  readEntryText(bytes: Uint8Array, path: string): Promise<string | null>;
  /** Batched variant over ONE entry source: the render-model reader needs
   *  workbook/styles/theme/worksheet parts together, and one source per part
   *  would re-inflate the package once per part. */
  readEntriesText(bytes: Uint8Array, paths: readonly string[]): Promise<Readonly<Record<string, string | null>>>;
  /** Apply the cell edits plus refreshed formula cached values in ONE
   *  assemble pass (applyCellEditsToXlsx with only the arguments this lane
   *  binds: edits + formulaValues). */
  applyCellEdits(
    source: Uint8Array,
    edits: readonly XlsxCellEdit[],
    formulaValues?: readonly XlsxSheetFormulaValues[],
  ): Promise<XlsxMutation>;
  /** The preservation guard: every package entry outside
   *  touched/added/removed must be byte-identical before/after; throws when
   *  the assembler drifted (xlsx-gateway.ts:1685). */
  assertPreserved(mutation: XlsxMutation): void;
}

// ── native recalculation port ──────────────────────────────────────────────

/** Sidecar wire edit (recalc.rs:36): `input` is user-input text — "=SUM(A1:A2)",
 *  "42", "TRUE", free text; "" clears the cell. */
export interface XlsxRecalcEdit {
  readonly sheet: string;
  readonly row: number;
  readonly column: number;
  readonly input: string;
}

/** Sidecar wire range (types.rs:356): 0-based inclusive bounds; the sidecar
 *  rejects reversed bounds, bounds outside the sheet and boxes over
 *  100_000 cells. */
export interface XlsxCellRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface XlsxRecalcRead {
  readonly sheet: string;
  readonly range: XlsxCellRange;
}

/** Sidecar wire cell (recalc.rs:54): `formatted` is the display string with
 *  number formats applied; `number` is present only for numeric results;
 *  `isError` distinguishes a typed error from text that spells one;
 *  `isFormula` marks cells that still carry a formula after the edits. */
export interface XlsxRecalcCell {
  readonly sheet: string;
  readonly row: number;
  readonly column: number;
  readonly formatted: string;
  readonly number?: number | undefined;
  readonly isError: boolean;
  readonly isFormula: boolean;
}

export interface XlsxRecalcResult {
  readonly cells: readonly XlsxRecalcCell[];
  /** True when the sidecar's resident model served the request. */
  readonly cached?: boolean | undefined;
}

/** The recalculation seam the adapter/service hold. Bytes-based so the port
 *  stays host-neutral: the Node implementation stages the bytes into the
 *  job's sandbox and drives the Rust sidecar over NDJSON. A host with no
 *  native runtime binds no port — the caller then answers with the contract
 *  warning (adapter) or a typed refusal (service), never a silent stale save. */
export interface XlsxRecalcPort {
  recalc(
    sourceBytes: Uint8Array,
    edits: readonly XlsxRecalcEdit[],
    reads: readonly XlsxRecalcRead[],
  ): Promise<XlsxRecalcResult>;
  /** Release the resident native process. Idempotent. */
  close(): Promise<void>;
}

/** Typed errors the adapter/handler branch on — `code` carries the meaning,
 *  never the message text. */
export class XlsxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "XlsxEngineError";
    this.code = code;
  }
}

/** Codes the recalc port / sidecar client report (closed set — the handler
 *  maps each to a worker outcome code). */
export const XLSX_SIDECAR_PROTOCOL_VERSION = 1;
