// DOC-003 engine host: XLSX routes on the native sidecar + xlsx-gateway.
//
// Sessions are keyed by viewId. Opening copies the lab fixture into the session
// directory first; the sidecar only ever opens that snapshot, so a recalc or save
// can never race the original file. The renderer surface speaks IPC sheet ids;
// the sidecar and the gateway speak file sheet names, so every crossing maps
// sheetId -> sheetName through the open result (sheets-main.ts:2561-2581 does the
// same on the product path).
//
// Recalculation runs in the native sidecar (xlsx-sidecar.exe) with sheet NAMES
// and its result is mapped back to sheetIds. The save is the gateway''s
// applyCellEditsToXlsx + writeXlsxAtomically (JSZip, no Electron, no sidecar), and
// computed values are handed over as formulaValues so the saved <v> matches the
// engine''s evaluation. The produced bytes are written to a private candidate and
// reopened there in a fresh sidecar session; only then are they published once
// onto the output, so a failed verify never replaces a previous good save.
import { randomUUID } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface XlsxSheetEdit {
  /** IPC sheet id; mapped to the file sheet name before it reaches the gateway. */
  sheetId: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: unknown;
  rich?: unknown;
  styleReset?: boolean;
}

export interface XlsxFormulaValue {
  sheetId: string;
  row: number;
  column: number;
  value: string | number | boolean | null | { error: string };
}

export interface XlsxStructuralOp {
  sheetId: string;
  kind: string;
  [key: string]: unknown;
}

export interface XlsxSheetMeta {
  id: string;
  name: string;
}

export interface XlsxOpenedWorkbook {
  sessionId: string;
  sheets: XlsxSheetMeta[];
  [key: string]: unknown;
}

/**
 * The sidecar's per-sheet metadata: the REQUIRED subset the renderer's
 * WorkbookFile contract reads, plus verbatim passthrough for every optional
 * field the sidecar also sends (sourceXmlBytes, defaultRowHeightFixed,
 * baseColumnWidth, showRowColHeaders, rightToLeft, zoomScale, printArea,
 * printTitles, hasScopedDefinedNames, pivotTables, sparklines, cellImages,
 * column-width styleIndex, ...). Required members are validated by name at open.
 */
export interface XlsxSheetMetadata extends XlsxSheetMeta {
  rowCount: number;
  columnCount: number;
  columnWidths: unknown[];
  hidden: boolean;
  tabColor: string | null;
  showGridLines: boolean;
  freeze: { frozenColumns: number; frozenRows: number } | null;
  defaultRowHeight: number | null;
  defaultColumnWidth: number | null;
  tables: unknown[];
  comments: unknown[];
  pivotRanges: unknown[];
  [key: string]: unknown;
}

/**
 * The sidecar's own workbook metadata, retained verbatim on the session. The
 * sidecar is the authority for this shape (native types.rs WorkbookMetadata /
 * desktop-api.ts workbookFileSchema): the engine-bridge must not re-narrow it.
 */
export interface XlsxWorkbookMetadata {
  entryCount: number;
  activeTab: number;
  styles: unknown[];
  dxfStyles: unknown[];
  visuals: unknown[];
  definedNames: unknown[];
  sheets: XlsxSheetMetadata[];
  [key: string]: unknown;
}

export interface XlsxRecalcCell {
  sheet: string;
  row: number;
  column: number;
  formatted: string;
  number?: number;
  isError?: boolean;
  isFormula: boolean;
}

export interface XlsxSidecarLike {
  open(path: string, locale?: string): Promise<XlsxOpenedWorkbook>;
  recalcCells(input: {
    path: string;
    edits: { sheet: string; row: number; column: number; input: string }[];
    reads: { sheet: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } }[];
  }): Promise<{ cells: XlsxRecalcCell[] }>;
  readRange(input: {
    sessionId: string;
    sheetId: string;
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  }): Promise<unknown>;
  readFormulaCells(input: { sessionId: string; sheetId: string }): Promise<{ cells: unknown[] }>;
  close(sessionId: string): Promise<void>;
  stop(): void;
  start?(): void;
}

/** packages/xlsx-gateway src/gateway/xlsx-gateway.ts CellEdit */
export interface XlsxGatewayCellEdit {
  sheetName: string;
  row: number;
  column: number;
  writeValue: boolean;
  cell: { value: unknown; formula?: string };
  style?: unknown;
  rich?: unknown;
  styleReset?: boolean;
}

export interface XlsxGatewayFormulaValues {
  sheetName: string;
  cells: { row: number; column: number; value: unknown }[];
}

export interface XlsxMutationLike {
  buffer: Buffer;
  touchedEntries: readonly string[];
}

export interface XlsxGatewayLike {
  applyCellEditsToXlsx(
    source: Buffer,
    edits: readonly XlsxGatewayCellEdit[],
    structuralOps?: readonly unknown[],
    chartEdits?: readonly unknown[],
    sheetPlan?: unknown,
    filterStates?: readonly unknown[],
    hyperlinkEdits?: readonly unknown[],
    cfStates?: readonly unknown[],
    dvStates?: readonly unknown[],
    sheetProtections?: readonly unknown[],
    definedNamesState?: unknown,
    pageSetupStates?: readonly unknown[],
    noteStates?: readonly unknown[],
    formulaValues?: readonly XlsxGatewayFormulaValues[],
  ): Promise<XlsxMutationLike>;
  writeXlsxAtomically(path: string, buffer: Buffer): Promise<void>;
  assertOnlyTouchedEntriesChanged(mutation: { touchedEntries: readonly string[] }): void;
}

export interface XlsxSession {
  viewId: string;
  sessionId: string;
  snapshotPath: string;
  sourcePath: string;
  binaryPath: string;
  sha256: string;
  bytes: number;
  sheets: XlsxSheetMeta[];
  /**
   * The sidecar's real workbook metadata, retained from open and rebound from a
   * successful save's verified reopen. The route emits this, so the renderer
   * sees the same rich WorkbookFile shape the native product path produces.
   */
  metadata: XlsxWorkbookMetadata;
  /** Published output path once a save has succeeded; absent before the first save. */
  savedPath?: string;
  /** Private snapshot backing the live sidecar after a save; absent before the first save. */
  savedSnapshotPath?: string;
}

export interface XlsxRecalcResultCell {
  sheetId: string;
  row: number;
  column: number;
  formatted: string;
  number?: number;
  isError?: boolean;
  isFormula: boolean;
}

export class XlsxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "XlsxEngineError";
    this.code = code;
  }
}

export interface XlsxSaveInput {
  session: XlsxSession;
  outPath: string;
  edits: XlsxGatewayCellEdit[];
  structuralOps?: readonly unknown[];
  formulaValues?: XlsxGatewayFormulaValues[];
  /** Optional workbook parts the renderer sends alongside cell edits. */
  extras?: {
    chartEdits?: readonly unknown[];
    filterStates?: readonly unknown[];
    hyperlinkEdits?: readonly unknown[];
    cfStates?: readonly unknown[];
    dvStates?: readonly unknown[];
    sheetProtections?: readonly unknown[];
    definedNamesState?: unknown;
    pageSetupStates?: readonly unknown[];
    noteStates?: readonly unknown[];
  };
}

export interface XlsxSaveResult {
  path: string;
  bytes: number;
  touched: readonly string[];
  sha256: string;
  reopenedSheets: string[];
  formulaCells: number;
}

export interface XlsxEngine {
  openFile(input: {
    viewId: string;
    sourcePath: string;
    sessionDir: string;
    binaryPath: string;
    locale?: string;
  }): Promise<XlsxSession>;
  sheetName(session: XlsxSession, sheetId: string): string;
  sheetId(session: XlsxSession, sheetName: string): string | undefined;
  has(viewId: string): boolean;
  readRange(
    session: XlsxSession,
    sheetId: string,
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  ): Promise<unknown>;
  readFormulaCells(session: XlsxSession, sheetId: string): Promise<{ cells: unknown[] }>;
  recalc(
    session: XlsxSession,
    edits: { sheetId: string; row: number; column: number; input: string }[],
    reads: {
      sheetId: string;
      range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
    }[],
  ): Promise<{ cells: XlsxRecalcResultCell[] }>;
  save(input: XlsxSaveInput): Promise<XlsxSaveResult>;
  close(viewId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface XlsxEngineDeps {
  createClient: (binaryPath: string) => XlsxSidecarLike;
  gateway: XlsxGatewayLike;
  sha256: (data: Uint8Array) => string;
  snapshot: (sessionDir: string, sourcePath: string) => Promise<{ path: string; bytes: number; hash: string }>;
}

/**
 * Validation for the sidecar's own metadata. The sidecar is the producer and the
 * renderer contract marks these members required, so a payload missing any of
 * them is refused by name instead of being forwarded and read as undefined
 * downstream. Optional members the contract also documents (sourceXmlBytes,
 * defaultRowHeightFixed, baseColumnWidth, showRowColHeaders, rightToLeft,
 * zoomScale, printArea, printTitles, hasScopedDefinedNames, column-width
 * styleIndex, ...) are retained verbatim without inventing a value.
 */
const requireMetadataString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be a non-empty string");
  }
  return value;
};

const requireMetadataCount = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be a non-negative integer");
  }
  return value;
};

const requireSheetDimension = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be a positive integer");
  }
  return value;
};

const requireMetadataBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be a boolean");
  }
  return value;
};

const requireMetadataArray = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be an array");
  }
  return value;
};

/**
 * The only three arrays the pinned upstream schema itself defaults to [] for a
 * stale sidecar binary: desktop-api.ts:177-241 pivotTables (".default([])"),
 * 244-267 sparklines and 280-291 cellImages. ONLY an omitted member may
 * materialize as []; an explicit null is a malformed payload and is refused by
 * name, exactly like any other out-of-contract value. A real supplied array is
 * validated and retained.
 */
const defaultedMetadataArray = (value: unknown, field: string): unknown[] =>
  value === undefined ? [] : requireMetadataArray(value, field);

/** A required nullable number: the value must be a number or an explicit null. */
const nullableNumber = (value: unknown, field: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be a non-negative number or null");
  }
  return value;
};

/** A required nullable color: the value must be a string or an explicit null. */
const nullableString = (value: unknown, field: string): string | null => {
  if (value === null) return null;
  return requireMetadataString(value, field);
};

const nullableFreeze = (
  value: unknown,
  field: string,
): { frozenColumns: number; frozenRows: number } | null => {
  if (value === null) return null;
  if (typeof value !== "object") {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + field + " must be an object or null");
  }
  const freeze = value as Record<string, unknown>;
  return {
    frozenColumns: requireMetadataCount(freeze.frozenColumns, field + ".frozenColumns"),
    frozenRows: requireMetadataCount(freeze.frozenRows, field + ".frozenRows"),
  };
};

/** One sheet: validated required members, then the sidecar's own fields verbatim. */
const sheetMetadataOf = (sheet: unknown, index: number): XlsxSheetMetadata => {
  const label = "sheets[" + index + "]";
  // A null/malformed item must be refused BY NAME. Reading sheet.id off it would
  // escape as an unattributed TypeError instead of the required field error.
  if (sheet === null || typeof sheet !== "object" || Array.isArray(sheet)) {
    throw new XlsxEngineError("open_invalid_response", "sidecar metadata " + label + " must be an object");
  }
  const record = sheet as Record<string, unknown>;
  return {
    ...record,
    id: requireMetadataString(record.id, label + ".id"),
    name: requireMetadataString(record.name, label + ".name"),
    rowCount: requireSheetDimension(record.rowCount, label + ".rowCount"),
    columnCount: requireSheetDimension(record.columnCount, label + ".columnCount"),
    columnWidths: requireMetadataArray(record.columnWidths, label + ".columnWidths"),
    freeze: nullableFreeze(record.freeze, label + ".freeze"),
    hidden: requireMetadataBoolean(record.hidden, label + ".hidden"),
    tabColor: nullableString(record.tabColor, label + ".tabColor"),
    showGridLines: requireMetadataBoolean(record.showGridLines, label + ".showGridLines"),
    defaultRowHeight: nullableNumber(record.defaultRowHeight, label + ".defaultRowHeight"),
    defaultColumnWidth: nullableNumber(record.defaultColumnWidth, label + ".defaultColumnWidth"),
    tables: requireMetadataArray(record.tables, label + ".tables"),
    comments: requireMetadataArray(record.comments, label + ".comments"),
    pivotRanges: requireMetadataArray(record.pivotRanges, label + ".pivotRanges"),
    // ONLY these three, and only when omitted: the upstream schema declares
    // ".default([])" for them (desktop-api.ts:241, 267, 291). Every other member
    // above is required there, so an absent one is refused, never defaulted.
    pivotTables: defaultedMetadataArray(record.pivotTables, label + ".pivotTables"),
    sparklines: defaultedMetadataArray(record.sparklines, label + ".sparklines"),
    cellImages: defaultedMetadataArray(record.cellImages, label + ".cellImages"),
  };
};

/**
 * The workbook metadata the renderer contract requires, kept verbatim. The
 * spread carries the sidecar's own optional members through unchanged; only the
 * required ones are validated, and the thin sheets array is replaced by the
 * validated per-sheet objects. No key is added that the sidecar did not send,
 * so the result still satisfies the strict upstream workbookFileSchema.
 */
const workbookMetadataOf = (opened: unknown): XlsxWorkbookMetadata => {
  // The payload container is validated BEFORE any member is read: a null or
  // non-object response must be a named refusal, never an unattributed TypeError.
  if (opened === null || typeof opened !== "object" || Array.isArray(opened)) {
    throw new XlsxEngineError("open_invalid_response", "sidecar returned no workbook object");
  }
  const payload = opened as Record<string, unknown>;
  const rawSheets = payload.sheets;
  if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
    throw new XlsxEngineError(
      "open_invalid_response",
      "sidecar metadata sheets must be a non-empty array",
    );
  }
  return {
    ...payload,
    entryCount: requireMetadataCount(payload.entryCount, "entryCount"),
    activeTab: requireMetadataCount(payload.activeTab, "activeTab"),
    styles: requireMetadataArray(payload.styles, "styles"),
    dxfStyles: requireMetadataArray(payload.dxfStyles, "dxfStyles"),
    visuals: requireMetadataArray(payload.visuals, "visuals"),
    definedNames: requireMetadataArray(payload.definedNames, "definedNames"),
    sheets: rawSheets.map((sheet, index) => sheetMetadataOf(sheet, index)),
  };
};

/**
 * The reopened bytes of a save are held to the SAME metadata contract as an
 * open, but every refusal is reported as the save's own named error. Any
 * unexpected throw (including one that would otherwise escape as a TypeError) is
 * normalized here, so a save that cannot describe its output is never an
 * unattributed crash and never a thin success.
 */
const reopenedMetadataOf = (reopened: unknown): XlsxWorkbookMetadata => {
  try {
    return workbookMetadataOf(reopened);
  } catch (error) {
    if (error instanceof XlsxEngineError && error.code === "save_verify_failed") throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new XlsxEngineError("save_verify_failed", "saved workbook could not be described: " + detail);
  }
};

/**
 * The reopened sidecar session id the live session will be rebound to. An
 * absent/blank id is a named save failure, so a save can never bind the session
 * to a missing identity.
 */
const verifiedSessionIdOf = (reopened: unknown): string => {
  const sessionId = (reopened as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new XlsxEngineError("save_verify_failed", "saved workbook reopened with no sessionId");
  }
  return sessionId;
};

/**
 * OWNERSHIP of the retained metadata.
 *
 * Three reference boundaries must stay separate, or a mutation silently changes
 * state nobody meant to change:
 *   1. the sidecar's own response object  ->  2. the stored session metadata
 *   3. every payload the route emits      ->  (a fresh copy, never 2)
 *
 * The sidecar's response is a JSON wire payload (the client forwards parsed
 * JSON), so a structural copy is exact for it and is what this module retains;
 * the engine never stores a reference the caller still holds. The route copies
 * the stored state again on emit, so a caller that mutates the returned
 * WorkbookFile cannot reach into the live session. Callers may treat both the
 * value they passed in and the value they were handed as their own.
 */
export const copyWorkbookMetadata = (metadata: XlsxWorkbookMetadata): XlsxWorkbookMetadata =>
  JSON.parse(JSON.stringify(metadata)) as XlsxWorkbookMetadata;

export function createXlsxEngine(deps: XlsxEngineDeps): XlsxEngine {
  const sessions = new Map<string, { session: XlsxSession; client: XlsxSidecarLike }>();

  const requireEntry = (viewId: string): { session: XlsxSession; client: XlsxSidecarLike } => {
    const entry = sessions.get(viewId);
    if (!entry) throw new XlsxEngineError("no_session", "no open workbook for view " + viewId);
    return entry;
  };

  const sheetNameOf = (session: XlsxSession, sheetId: string): string => {
    const match = session.sheets.find((sheet) => sheet.id === sheetId);
    if (!match) throw new XlsxEngineError("unknown_sheet", "no sheet for id " + sheetId);
    return match.name;
  };

  return {
    async openFile({ viewId, sourcePath, sessionDir, binaryPath, locale }) {
      if (sessions.has(viewId)) throw new XlsxEngineError("session_exists", "view already owns a workbook");
      const copy = await deps.snapshot(sessionDir, sourcePath);
      const client = deps.createClient(binaryPath);
      const opened = await client.open(copy.path, locale ?? "en");
      // The response container is checked first so a null/non-object answer is a
      // named refusal rather than a TypeError on the first member read.
      if (opened === null || typeof opened !== "object" || Array.isArray(opened)) {
        client.stop();
        throw new XlsxEngineError("open_invalid_response", "sidecar returned no workbook object for " + sourcePath);
      }
      if (!Array.isArray(opened.sheets) || opened.sheets.length === 0) {
        client.stop();
        throw new XlsxEngineError("open_failed", "sidecar returned no sheets for " + sourcePath);
      }
      if (typeof opened.sessionId !== "string" || opened.sessionId.length === 0) {
        client.stop();
        throw new XlsxEngineError("open_invalid_response", "sidecar returned no sessionId for " + sourcePath);
      }
      // The sidecar is already running, so a payload we refuse must still release
      // it: a named refusal that leaks a process would be its own defect.
      let metadata: XlsxWorkbookMetadata;
      try {
        metadata = copyWorkbookMetadata(workbookMetadataOf(opened));
      } catch (error) {
        client.stop();
        throw error;
      }
      const session: XlsxSession = {
        viewId,
        sessionId: opened.sessionId,
        snapshotPath: copy.path,
        sourcePath,
        binaryPath,
        sha256: copy.hash,
        bytes: copy.bytes,
        // The full sheet metadata is retained, not narrowed to id/name: the route
        // emits it and the renderer reads dimensions, widths and view flags off it.
        sheets: metadata.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name })),
        metadata,
      };
      sessions.set(viewId, { session, client });
      return session;
    },

    sheetName: sheetNameOf,

    sheetId: (session, sheetName) => session.sheets.find((sheet) => sheet.name === sheetName)?.id,

    has: (viewId) => sessions.has(viewId),

    async readRange(session, sheetId, range) {
      const entry = requireEntry(session.viewId);
      return entry.client.readRange({ sessionId: session.sessionId, sheetId, range });
    },

    async readFormulaCells(session, sheetId) {
      const entry = requireEntry(session.viewId);
      return entry.client.readFormulaCells({ sessionId: session.sessionId, sheetId });
    },

    async recalc(session, edits, reads) {
      const entry = requireEntry(session.viewId);
      // The sidecar speaks file sheet names; the IPC surface speaks sheet ids.
      const result = await entry.client.recalcCells({
        path: session.snapshotPath,
        edits: edits.map((edit) => ({
          sheet: sheetNameOf(session, edit.sheetId),
          row: edit.row,
          column: edit.column,
          input: edit.input,
        })),
        reads: reads.map((read) => ({
          sheet: sheetNameOf(session, read.sheetId),
          range: read.range,
        })),
      });
      const idByName = new Map(session.sheets.map((sheet) => [sheet.name, sheet.id]));
      const cells: XlsxRecalcResultCell[] = (result.cells ?? []).flatMap((cell) => {
        const sheetId = idByName.get(cell.sheet);
        if (sheetId === undefined) return [];
        return [
          {
            sheetId,
            row: cell.row,
            column: cell.column,
            formatted: cell.formatted,
            ...(cell.number === undefined ? {} : { number: cell.number }),
            ...(cell.isError ? { isError: true } : {}),
            isFormula: cell.isFormula,
          },
        ];
      });
      return { cells };
    },

    async save({ session, outPath, edits, structuralOps, formulaValues, extras }) {
      const entry = requireEntry(session.viewId);
      const source = await readFile(session.snapshotPath);
      const mutation = await deps.gateway.applyCellEditsToXlsx(
        source,
        edits,
        structuralOps ?? [],
        extras?.chartEdits ?? [],
        undefined,
        extras?.filterStates ?? [],
        extras?.hyperlinkEdits ?? [],
        extras?.cfStates ?? [],
        extras?.dvStates ?? [],
        extras?.sheetProtections ?? [],
        extras?.definedNamesState ?? null,
        extras?.pageSetupStates ?? [],
        extras?.noteStates ?? [],
        formulaValues ?? [],
      );
      deps.gateway.assertOnlyTouchedEntriesChanged(mutation);
      // The produced bytes go to a private candidate beside the output. A stable
      // saved snapshot and an already-opened NEXT sidecar are prepared BEFORE the
      // single atomic publish, so verification never runs after the output has
      // been replaced, and the live session is rebound in memory only.
      const candidatePath = join(
        dirname(outPath),
        "." + basename(outPath) + "." + randomUUID() + ".candidate.xlsx",
      );
      const savedSnapshotPath = join(
        dirname(session.snapshotPath),
        ".saved-" + randomUUID() + ".xlsx",
      );
      let nextClient: XlsxSidecarLike | undefined;
      let published = false;
      try {
        await deps.gateway.writeXlsxAtomically(candidatePath, mutation.buffer);
        const candidate = await readFile(candidatePath);
        const candidateSha256 = deps.sha256(candidate);
        const candidateBytes = candidate.length;
        // The saved bytes become the session's new immutable input, staged in the
        // private session directory so the prepared sidecar can read it lazily.
        await deps.gateway.writeXlsxAtomically(savedSnapshotPath, candidate);
        nextClient = deps.createClient(session.binaryPath);
        const verifier = nextClient;
        let reopenedSheets: string[] = [];
        let nextSheets: XlsxSheetMeta[] = [];
        let formulaCells = 0;
        const reopened = await verifier.open(savedSnapshotPath, "en");
        // The reopened bytes are validated exactly like an open, but a payload the
        // engine cannot describe fails the SAVE: every refusal is the named
        // save_verify_failed, never an unattributed TypeError. Nothing above this
        // line has touched the live session or the output, so the previous good
        // output and session survive a failed verification intact.
        const nextMetadata = reopenedMetadataOf(reopened);
        const reopenedSessionId = verifiedSessionIdOf(reopened);
        const firstSheet = nextMetadata.sheets[0];
        if (firstSheet === undefined) {
          throw new XlsxEngineError("save_verify_failed", "saved workbook reopened with no sheets");
        }
        reopenedSheets = nextMetadata.sheets.map((sheet) => sheet.name);
        nextSheets = nextMetadata.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }));
        const formulas = await verifier.readFormulaCells({
          sessionId: reopenedSessionId,
          sheetId: firstSheet.id,
        });
        formulaCells = Array.isArray(formulas.cells) ? formulas.cells.length : 0;
        // Single atomic publish of the already-verified bytes onto the output.
        await rename(candidatePath, outPath);
        published = true;
        // Publication succeeded: only now rebind the live session in memory, with
        // no fallible reopen, so earlier edits survive the next read/recalc/save.
        const previousSavedSnapshot = session.savedSnapshotPath;
        const previousClient = entry.client;
        const previousSessionId = session.sessionId;
        session.snapshotPath = savedSnapshotPath;
        session.savedSnapshotPath = savedSnapshotPath;
        session.sessionId = reopenedSessionId;
        session.sha256 = candidateSha256;
        session.bytes = candidateBytes;
        session.sheets = nextSheets;
        // The published workbook's OWN metadata replaces the pre-save metadata, so
        // activeTab/entryCount/styles/visuals/definedNames and per-sheet dimensions
        // describe the saved bytes, not the workbook the session started from.
        session.metadata = copyWorkbookMetadata(nextMetadata);
        session.savedPath = outPath;
        entry.client = verifier;
        nextClient = undefined;
        // Old sidecar/snapshot cleanup is separate: it must never turn a
        // successful publication into a failed save.
        try {
          await previousClient.close(previousSessionId).catch(() => undefined);
          previousClient.stop();
          if (previousSavedSnapshot && previousSavedSnapshot !== savedSnapshotPath) {
            await rm(previousSavedSnapshot, { force: true }).catch(() => undefined);
          }
        } catch {
          // Best effort only; the save has already been published.
        }
        return {
          path: outPath,
          bytes: candidate.length,
          touched: mutation.touchedEntries,
          sha256: session.sha256,
          reopenedSheets,
          formulaCells,
        };
      } finally {
        if (!published) {
          try {
            nextClient?.stop();
          } catch {
            // Preserve the original failure and still attempt scratch cleanup.
          }
          await rm(savedSnapshotPath, { force: true }).catch(() => undefined);
          await rm(candidatePath, { force: true }).catch(() => undefined);
        }
      }
    },

    async close(viewId) {
      const entry = sessions.get(viewId);
      if (!entry) return;
      sessions.delete(viewId);
      await entry.client.close(entry.session.sessionId).catch(() => undefined);
      entry.client.stop();
    },

    async closeAll() {
      for (const viewId of [...sessions.keys()]) await this.close(viewId);
    },
  };
}

export async function loadXlsxDeps(sourceRoot: string): Promise<{
  createClient: (binaryPath: string) => XlsxSidecarLike;
  gateway: XlsxGatewayLike;
}> {
  const clientMod = (await import(
    pathToFileURL(join(sourceRoot, "apps/sheets/src/main/xlsx-sidecar-client.ts")).href
  )) as { XlsxSidecarClient: new (binaryPath: string) => XlsxSidecarLike };
  const gateway = (await import(
    pathToFileURL(join(sourceRoot, "packages/xlsx-gateway/src/gateway/xlsx-gateway.ts")).href
  )) as XlsxGatewayLike;
  return {
    createClient: (binaryPath) => new clientMod.XlsxSidecarClient(binaryPath),
    gateway,
  };
}

/** Where the pinned source keeps a built sidecar binary (never resolved via Electron app). */
export function sidecarBinaryPath(sourceRoot: string): string {
  const name = process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
  return join(sourceRoot, "apps/sheets/native/xlsx-engine/target/release", name);
}
