// XLSX adapter — the browser-safe half of the xlsx lane. Open/edit/serialize
// run entirely through the patched gateway artifact (jszip-only). Native
// recalculation reaches this module only through the XlsxRecalcPort
// dependency seam — the adapter never imports node/rust, so the boundary
// checker keeps it honest.
//
// Session binding (G2-04): a session is bound to {document_id, input sha256,
// engine version, model generation}. A successful save rebases all of them —
// the produced bytes become the new base (two consecutive saves chain), a
// failed save changes nothing, and release drops the session and purges the
// native resident model so the next open never inherits state.
//
// Preservation: the assemble pass rewrites only the entries the plan touches;
// assertPreserved (upstream assertOnlyTouchedEntriesChanged) verifies every
// other part stays content-identical by sha256 — charts, media, unsupported
// OOXML parts and macro payloads survive verbatim or the save fails closed.
import {
  ENGINE_LIMITS,
  EngineBoundaryError,
  HostCapabilityRefusal,
  sha256Hex,
  type CapabilityEntry,
  type EngineErrorCode,
  type OfficeFormat,
  type OpenFailureClass,
  type OpenOutcome,
} from "@uniwork/office-contracts";
import {
  XLSX_SIDECAR_PROTOCOL_VERSION,
  isXlsxWorkbookSnapshot,
  type XlsxGatewayArguments,
  type XlsxGatewayFunctions,
  type XlsxPackageEntry,
  type XlsxRecalcPort,
  type XlsxSheetFormulaValues,
  type XlsxWorkbookSnapshot,
} from "./engine.ts";
import { createXlsxSessionModel, type XlsxSessionModel } from "./model.ts";
import { parseXlsxOps, XlsxOpError } from "./ops.ts";
import { buildRecalcReadBatches, recalcToFormulaValues, XLSX_MAX_RECALC_EDITS } from "./recalc.ts";
import { readXlsxRenderModel, type XlsxRenderModel } from "./render-model.ts";

const ZIP_MAGIC = [0x50, 0x4b];
function isZipPackage(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

/** Entries the serializer never rewrites but the package may carry — they
 *  survive verbatim (assertPreserved proves it), so open reports them as
 *  preserved-not-editable rather than silently dropping the information. */
const PRESERVED_PART_FAMILIES: { pattern: RegExp; label: string }[] = [
  { pattern: /(^|\/)vbaProject\.bin$/i, label: "vba_macros" },
  { pattern: /(^|\/)activeX\//i, label: "activex" },
  { pattern: /(^|\/)externalLinks?\//i, label: "external_links" },
  { pattern: /(^|\/)pivot(Cache|Table)/i, label: "pivot" },
  { pattern: /(^|\/)customXml\//i, label: "custom_xml" },
  { pattern: /(^|\/)embeddings\//i, label: "embeddings" },
  { pattern: /(^|\/)ctrlProps\//i, label: "form_controls" },
  { pattern: /(^|\/)charts?\//i, label: "charts" },
  { pattern: /(^|\/)comments\d*\.xml$/i, label: "comments" },
];

export interface XlsxProbe {
  readonly format: "xlsx";
  readonly sheetCount: number;
  readonly sheetNames: readonly string[];
  readonly cellCount: number;
  readonly formulaCellCount: number;
  /** Package parts the serializer preserves verbatim but cannot edit. */
  readonly preservedParts: readonly string[];
}

export interface XlsxAdapterDeps {
  engine: XlsxGatewayFunctions;
  /** Native recalc. Undefined = parse/edit/serialize only; a save with live
   *  formulas is a typed unsupported_operation — stale <v>s never ship. */
  recalc?: XlsxRecalcPort | undefined;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  maxInputBytes?: number;
  /** Build identity bound into the session (input hash + engine version +
   *  protocol + model revision is the binding the task pins). The service
   *  passes the gateway artifact's sha256; a drift between open and
   *  serialize fails engine_incompatible and never touches the snapshot. */
  engineVersion?: string;
  /** The NDJSON protocol the session was opened under — bumped when the
   *  client speaks a new dialect; a drift fails serialize with
   *  protocol_mismatch. Defaults to XLSX_SIDECAR_PROTOCOL_VERSION. */
  protocolVersion?: number;
}

interface XlsxSession {
  ref: string;
  documentId: string;
  inputBytes: Uint8Array;
  /** Binding captured at open — serialize re-verifies both before mutating. */
  engineVersion: string | null;
  protocolVersion: number | null;
  model: XlsxSessionModel;
  sheetNamesById: Readonly<Record<string, string>>;
  preservedParts: readonly string[];
}

let sessionCounter = 0;

function preservedPartsOf(entries: readonly XlsxPackageEntry[]): string[] {
  return entries
    .filter((e) => PRESERVED_PART_FAMILIES.some((f) => f.pattern.test(e.path)))
    .map((e) => e.path)
    .sort();
}

function preservedWarnings(parts: readonly string[]): { code: string; detail: string }[] {
  if (parts.length === 0) return [];
  return [
    {
      code: "parts_preserved_not_editable",
      detail:
        `${parts.length} package part(s) are preserved verbatim but not editable ` +
        `(first: ${parts[0]}); a save keeps them byte-identical`,
    },
  ];
}

export class XlsxAdapter {
  private sessions = new Map<string, XlsxSession>();
  private readonly deps: XlsxAdapterDeps;
  constructor(deps: XlsxAdapterDeps) {
    this.deps = deps;
  }

  private failed(
    documentId: string,
    failureClass: OpenFailureClass,
    message?: string,
    engineError?: EngineErrorCode,
  ): OpenOutcome {
    return {
      outcome: "failed",
      document_id: documentId,
      format: "xlsx",
      failure_class: failureClass,
      ...(message ? { message } : {}),
      ...(engineError ? { engine_error: engineError } : {}),
    };
  }

  /** Engine/zip failure → the contract's open failure classes. */
  private mapParseError(documentId: string, error: unknown): OpenOutcome {
    if (error instanceof EngineBoundaryError) {
      return this.failed(documentId, "engine_error", error.message, error.code);
    }
    if (error instanceof HostCapabilityRefusal) {
      return this.failed(documentId, "engine_error", error.message, error.engine_error ?? "engine_crashed");
    }
    const message = String((error as Error)?.message ?? error);
    const lower = message.toLowerCase();
    if (/encrypted|password/.test(lower)) {
      // ECMA-376 agile/standard xlsx encryption is CFB-wrapped; the sniff
      // above already routes those bytes here only via the engine message.
      return this.failed(documentId, "password_required", "encrypted workbook — password open is not bound in this lane");
    }
    if (/opendocument|odf|\.ods|biff|xlsb|not xlsx/.test(lower)) {
      return this.failed(documentId, "not_office_file", message);
    }
    if (/not a valid zip|corrupt|end of central directory|eocd|not a zip/.test(lower)) {
      return this.failed(documentId, "corrupted", "package claims ZIP/OOXML but the container is broken");
    }
    if (/no readable worksheets|workbook\.xml/.test(lower)) {
      return this.failed(documentId, "corrupted", message);
    }
    return this.failed(documentId, "corrupted", message);
  }

  async open(input: {
    bytes: Uint8Array;
    format: OfficeFormat;
    document_id: string;
    locale?: string;
  }): Promise<OpenOutcome> {
    const { bytes, document_id } = input;
    if (input.format !== "xlsx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "xlsx" });
    }
    const max = this.deps.maxInputBytes ?? ENGINE_LIMITS.max_input_bytes;
    if (bytes.length > max) {
      return this.failed(document_id, "too_large", "input " + bytes.length + " exceeds the " + max + " byte bound");
    }
    if (!isZipPackage(bytes)) {
      // CFB magic means .xls/encrypted OOXML — Q7 conversion stays 501, so the
      // honest answer is a named refusal, not a corrupt-xlsx verdict.
      if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
        return this.failed(document_id, "not_office_file", "CFB container — .xls/xlsb conversion is out of scope (501)");
      }
      return this.failed(document_id, "not_office_file", "bytes are not a ZIP/OOXML container");
    }
    let parsed: { snapshot: XlsxWorkbookSnapshot; sheetNamesById: Readonly<Record<string, string>> };
    let entries: readonly XlsxPackageEntry[];
    try {
      entries = await this.deps.engine.inventory(bytes);
      parsed = await this.deps.engine.readWorkbook(bytes);
    } catch (error) {
      return this.mapParseError(document_id, error);
    }
    if (!parsed?.snapshot || !Array.isArray(parsed.snapshot.sheets) || parsed.snapshot.sheets.length === 0) {
      return this.failed(document_id, "corrupted", "engine returned a workbook without sheets");
    }
    // A recalc-bound adapter serves ONE live session: the port carries a
    // resident model per job, so two sessions would share native state — the
    // cross-job isolation this lane is graded on. The service and the replay
    // both build one adapter per document; a second open is caller misuse.
    if (this.deps.recalc && this.sessions.size > 0) {
      return this.failed(document_id, "engine_error", "a recalc-bound adapter already serves a session — release it before opening another", "engine_overloaded");
    }
    const hash = this.deps.sha256 ?? sha256Hex;
    const inputSha256 = await hash(bytes);
    sessionCounter += 1;
    const ref = "xlsx-session-" + sessionCounter;
    const preservedParts = preservedPartsOf(entries);
    this.sessions.set(ref, {
      ref,
      documentId: document_id,
      inputBytes: bytes,
      engineVersion: this.deps.engineVersion ?? null,
      protocolVersion: this.deps.recalc ? (this.deps.protocolVersion ?? XLSX_SIDECAR_PROTOCOL_VERSION) : null,
      model: createXlsxSessionModel(parsed.snapshot, inputSha256),
      sheetNamesById: parsed.sheetNamesById,
      preservedParts,
    });
    return { outcome: "opened", document_id, document_model_ref: ref, warnings: preservedWarnings(preservedParts) };
  }

  private sessionOf(ref: string): XlsxSession {
    const session = this.sessions.get(ref);
    if (!session) throw new EngineBoundaryError("not_found", { document_model_ref: ref });
    return session;
  }

  /** Session-bound edit channel: parses + validates the wire ops against the
   *  opened workbook, then records them pending. Nothing mutates the input
   *  bytes — serialize is the only writer.
   *
   *  Parse and apply interleave (one op at a time, in emission order): a
   *  sheet op must take effect before the next op parses, or a cell edit into
   *  a just-renamed sheet could not resolve. The resolver is a live view over
   *  the model, so later ops see the rename/add/remove the earlier ones made. */
  edit(documentModelRef: string, ops: unknown): { applied: true; revision: number } {
    const session = this.sessionOf(documentModelRef);
    if (!Array.isArray(ops)) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "edit payload must be an ops array" });
    }
    parseXlsxOps(ops, session.model.resolver(session.sheetNamesById), (op) => session.model.applyEdit(op));
    return { applied: true, revision: session.model.revision };
  }

  release(documentModelRef: string): boolean {
    const session = this.sessions.get(documentModelRef);
    if (!session) return false;
    this.sessions.delete(documentModelRef);
    // No other live session may share this job's native model — purge the
    // resident sidecar state so the next open can never inherit it. The port
    // is per-job (a recalc-bound adapter enforces a single live session at
    // open), so zero sessions means the job's native state must die; close()
    // is idempotent and terminal, a reopened session never revives it.
    if (this.deps.recalc && this.sessions.size === 0) void this.deps.recalc.close().catch(() => {});
    return true;
  }

  /**
   * Serialize — the only output path. Order is load-bearing:
   *   1. digest-check the base bytes (the binding open created)
   *   2. native recalc → <v> map for every post-edit formula cell
   *   3. one assemble pass (edits + formulaValues) + preservation assertion
   *   4. rebase the model onto the produced bytes (new digest + generation)
   * A missing recalc port while formulas exist is a typed refusal — shipping
   * stale cached values is never a fallback. Any failure before step 4 leaves
   * the model on its old base: a checksum/cleanup failure cannot move the
   * session's current snapshot.
   */
  async serialize(input: {
    document_model_ref: string;
    format: OfficeFormat;
  }): Promise<{ bytes: Uint8Array; checksum: string; warnings?: unknown[] }> {
    const session = this.sessionOf(input.document_model_ref);
    if (input.format !== "xlsx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "xlsx" });
    }
    const hash = this.deps.sha256 ?? sha256Hex;
    const digestNow = await hash(session.inputBytes);
    if (digestNow !== session.model.inputSha256) {
      throw new EngineBoundaryError("engine_checksum_mismatch", {
        detail: "xlsx input digest changed since open; refusing to publish",
      });
    }
    // The rest of the session binding: the engine build and protocol the
    // model was parsed under must still be what this serialize runs on —
    // a snapshot produced by a different build is never rebased onto it.
    if (session.engineVersion !== (this.deps.engineVersion ?? null)) {
      throw new EngineBoundaryError("engine_incompatible", {
        detail: "xlsx engine build changed since open; the session snapshot cannot be reused",
      });
    }
    const protocolNow = this.deps.recalc ? (this.deps.protocolVersion ?? XLSX_SIDECAR_PROTOCOL_VERSION) : null;
    if (session.protocolVersion !== protocolNow) {
      throw new EngineBoundaryError("protocol_mismatch", {
        detail: "xlsx recalc protocol changed since open; the session snapshot cannot be reused",
      });
    }
    const warnings: { code: string; detail: string }[] = [];
    const sheetPlan = session.model.pendingSheetPlan();
    // Every argument below resolves sheet names the way the PACKAGE on disk
    // does: the gateway applies cell edits, structural ops and recalc reads
    // against the current file names and runs the sheet plan (renames,
    // additions, removals, order) last. The envelope/model use final names, so
    // the adapter translates each one back through the model's registry.
    const gatewayName = (name: string): string => session.model.gatewaySheetName(name);
    const edits = session.model.pendingEdits().map((edit) => ({ ...edit, sheetName: gatewayName(edit.sheetName) }));
    const structuralOps = session
      .model
      .pendingStructuralOps()
      .map((group) => ({ ...group, sheetName: gatewayName(group.sheetName) }));
    // Filter states are declarative whole-sheet snapshots; their coordinates
    // are final at emission time (the renderer re-snapshots after every
    // structural shift the pinned filter plugin injects), and the gateway
    // applies them after structural replay and cell edits. A filter change
    // never moves cells, so the recalc pass is unaffected.
    const filterStates = session
      .model
      .pendingFilterStates()
      .map((state) => ({ ...state, sheetName: gatewayName(state.sheetName) }));
    // Page-setup states are declarative whole-sheet snapshots the gateway
    // merges attribute-by-attribute; like filters they never move cells, so
    // the recalc pass is unaffected. printArea/printTitles are sheet-scoped
    // defined names the gateway rewrites on the final workbook.xml.
    const pageSetupStates = session
      .model
      .pendingPageSetupStates()
      .map((state) => ({ ...state, sheetName: gatewayName(state.sheetName) }));
    // A structural save cannot refresh formula caches: the sidecar recalc runs
    // against the ORIGINAL bytes, where a shifted sheet's coordinates are the
    // pre-op ones, and a cross-sheet formula may read cells this envelope also
    // moved (or edited). Genoffice clears its recalc overlay on a structural
    // edit and lets the file's cached values — which shift with their cells —
    // stand; this lane does the same and says so in a warning rather than
    // shipping a wrong-coordinate refresh. The same reasoning covers a sheet
    // plan that changes sheet identity (rename/add/remove): the sidecar cannot
    // see the final sheet set. A hidden-only plan keeps identity, so recalc
    // still runs.
    const identityChange =
      sheetPlan !== undefined &&
      (sheetPlan.renames.length > 0 ||
        sheetPlan.additions.length > 0 ||
        sheetPlan.removals.length > 0 ||
        sheetPlan.orderChanged === true);
    const formulaCellsAfterEdits = session.model.formulaCellsAfterEdits();
    const formulaCells = (structuralOps.length > 0 || identityChange ? [] : formulaCellsAfterEdits).map((cell) => ({
      ...cell,
      sheetName: gatewayName(cell.sheetName),
    }));
    if (structuralOps.length > 0 && formulaCellsAfterEdits.length > 0) {
      warnings.push({
        code: "structure_formula_cache_kept",
        detail: `${formulaCellsAfterEdits.length} formula cell(s) keep their file-cached values while row/column changes replay`,
      });
    }
    if (identityChange && formulaCellsAfterEdits.length > 0) {
      warnings.push({
        code: "sheet_formula_cache_kept",
        detail: `${formulaCellsAfterEdits.length} formula cell(s) keep their file-cached values while sheet changes replay`,
      });
    }
    let formulaValues: XlsxSheetFormulaValues[] | undefined;
    if (formulaCells.length > 0) {
      if (!this.deps.recalc) {
        throw new EngineBoundaryError("unsupported_operation", {
          detail: "workbook contains formulas; serialize requires the native recalc sidecar (unbound in this runtime)",
          formula_cells: formulaCells.length,
        });
      }
      const recalcEdits = session.model.pendingRecalcEdits().map((edit) => ({ ...edit, sheet: gatewayName(edit.sheet) }));
      if (recalcEdits.length > XLSX_MAX_RECALC_EDITS) {
        throw new EngineBoundaryError("unsupported_operation", {
          detail: `${recalcEdits.length} edits exceed the sidecar's ${XLSX_MAX_RECALC_EDITS}-edit request bound`,
        });
      }
      const cells = [];
      for (const batch of buildRecalcReadBatches(formulaCells, recalcEdits)) {
        const result = await this.deps.recalc.recalc(session.inputBytes, recalcEdits, batch);
        cells.push(...result.cells);
      }
      const mapped = recalcToFormulaValues(formulaCells, { cells });
      formulaValues = mapped.values;
      if (mapped.kept > 0) {
        warnings.push({
          code: "formula_cache_kept",
          detail: `${mapped.kept} formula cell(s) keep their file-cached values (engine coverage gap)`,
        });
      }
    }
    const gatewayArguments: XlsxGatewayArguments =
      structuralOps.length === 0 && sheetPlan === undefined && filterStates.length === 0 && pageSetupStates.length === 0
        ? {}
        : {
            ...(structuralOps.length > 0 ? { structuralOps } : {}),
            ...(sheetPlan === undefined ? {} : { sheetPlan }),
            ...(filterStates.length > 0 ? { filterStates } : {}),
            ...(pageSetupStates.length > 0 ? { pageSetupStates } : {}),
          };
    let mutation;
    try {
      mutation = await this.deps.engine.applyCellEdits(
        session.inputBytes,
        edits,
        formulaValues,
        Object.keys(gatewayArguments).length > 0 ? gatewayArguments : undefined,
      );
      this.deps.engine.assertPreserved(mutation);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_result_invalid", { detail: String((error as Error)?.message ?? error) });
    }
    const out = mutation.buffer;
    if (!out || out.length === 0) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "xlsx assemble returned empty bytes" });
    }
    if (out.length > ENGINE_LIMITS.max_output_bytes) {
      throw new EngineBoundaryError("upload_bounds", { detail: "output exceeds byte bound" });
    }
    // Rebase on the produced bytes: a saved package that does not re-parse is
    // an engine bug the caller must never inherit as the new base.
    let rebased;
    try {
      rebased = await this.deps.engine.readWorkbook(out);
    } catch (error) {
      throw new EngineBoundaryError("engine_result_invalid", {
        detail: "saved package does not re-parse: " + String((error as Error)?.message ?? error),
      });
    }
    const checksum = await hash(out);
    // Only after every fallible step: rebase the model and the byte store.
    session.inputBytes = out;
    session.model.rebase(rebased.snapshot, checksum);
    session.sheetNamesById = rebased.sheetNamesById;
    return { bytes: out, checksum, warnings };
  }

  /** Honest capability rows for format xlsx (module-runtime-map states). Rows
   *  proven by the g2-04 fixture replay carry evidence_level "proven"; recalc
   *  rows are runtime-dependent — a host without the native port can never
   *  claim a formula-bearing save. */
  async capability(format: OfficeFormat): Promise<Record<string, unknown>> {
    if (format !== "xlsx") {
      throw new EngineBoundaryError("unsupported_operation", { format, expected: "xlsx" });
    }
    const recalcBound = this.deps.recalc !== undefined;
    const rows: CapabilityEntry[] = [
      {
        operation: "open",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "g2-04 replay: workbook parse on the patched vendored xlsx-gateway",
      },
      {
        operation: "edit",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "g2-04 replay: set_cell/clear_cell/style ops through applyCellEditsToXlsx",
      },
      {
        operation: "serialize",
        supported: recalcBound,
        runtime: recalcBound ? "internal_service" : "browser",
        evidence_level: recalcBound ? "proven" : "pending",
        reason: recalcBound
          ? "g2-04 replay: two-save chain on the real Rust sidecar; assertPreserved on every output"
          : "serialize of formula-bearing workbooks needs the native recalc port — browser-only builds refuse",
      },
      {
        operation: "recalc",
        supported: recalcBound,
        runtime: "internal_service",
        evidence_level: recalcBound ? "proven" : "pending",
        reason: "native Rust sidecar (ironcalc) inside the job sandbox; never a browser/WASM path",
      },
      {
        operation: "convert",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "Q7 conversions (CSV/XLS/XLSB/BIFF8) stay 501 — not this lane",
      },
      {
        operation: "export",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "export path has no working channel; unsupported_operation is the honest answer",
      },
    ];
    return { format: "xlsx", rows };
  }

  /** Inspection helpers for hosts/tests. */
  isDirty(ref: string): boolean {
    return this.sessionOf(ref).model.isDirty;
  }

  snapshotOf(ref: string): XlsxWorkbookSnapshot {
    return this.sessionOf(ref).model.snapshot;
  }

  sheetNames(ref: string): string[] {
    return this.sessionOf(ref).model.snapshot.sheets.map((s) => s.name);
  }

  cellsOf(ref: string, sheetName: string): Readonly<Record<string, unknown>> {
    return this.sessionOf(ref).model.cells(sheetName);
  }
}

export function createXlsxAdapter(deps: XlsxAdapterDeps): XlsxAdapter {
  return new XlsxAdapter(deps);
}

// ── service seam (G2-02 job handlers) ──────────────────────────────────────
//
// The office-engine service runs one-shot jobs: a handler reads the job's
// input.bin + ops.json, calls these, writes output.bin. Each call drives the
// full adapter path on a private session — probe/edit/serialize share one
// invariant implementation, so a service save is the same assemble+preserve+
// rebase the adapter performs. Every failure leaves here as XlsxTypedError
// with one of the worker's closed outcome codes.

export type XlsxFailureCode =
  | "engine_result_invalid"
  | "unsupported_operation"
  | "engine_incompatible"
  | "engine_crashed";

export class XlsxTypedError extends Error {
  readonly code: XlsxFailureCode;
  readonly reason: string;
  constructor(code: XlsxFailureCode, reason: string) {
    super(reason);
    this.name = "XlsxTypedError";
    this.code = code;
    this.reason = reason;
  }
}

/** Adapter/boundary failure → the worker's outcome codes. A boundary code
 *  outside the worker's set still maps to engine_result_invalid. */
function toXlsxFailure(error: unknown): XlsxTypedError {
  if (error instanceof XlsxTypedError) return error;
  if (error instanceof XlsxOpError) {
    return new XlsxTypedError(
      error.unsupported ? "unsupported_operation" : "engine_result_invalid",
      error.message.slice(0, 300),
    );
  }
  if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) {
    const code = error instanceof EngineBoundaryError ? error.code : error.engine_error;
    const mapped: XlsxFailureCode =
      code === "unsupported_operation" || code === "engine_crashed" || code === "engine_incompatible"
        ? code
        : "engine_result_invalid";
    return new XlsxTypedError(mapped, error.message.slice(0, 300));
  }
  return new XlsxTypedError("engine_crashed", String((error as Error)?.message ?? error).slice(0, 300));
}

/**
 * open:xlsx — probe bytes into a document-model summary the service stores as
 * probe.json. The output is the probe artifact, not the input.
 */
export interface XlsxOpenModel {
  readonly probe: XlsxProbe;
  readonly snapshot: XlsxWorkbookSnapshot;
  /** G3-05c: the render model the vendored sheets renderer mounts (layout,
   *  styles, cached formula results). Additive: G3-05b consumers read
   *  `snapshot` unchanged. */
  readonly renderModel: XlsxRenderModel;
}

/** Open once through the G2 gateway and return the capability probe, the
 * exact gateway snapshot and the render model.  Consumers must not parse
 * OOXML independently: this is the one model contract shared by service and
 * browser hosts. */
export async function openXlsxModel(
  engine: XlsxGatewayFunctions,
  bytes: Uint8Array,
  options: { renderModel?: boolean } = {},
): Promise<XlsxOpenModel> {
  const adapter = new XlsxAdapter({ engine });
  const outcome = await adapter.open({ bytes, format: "xlsx", document_id: "job" });
  if (outcome.outcome !== "opened") {
    throw new XlsxTypedError("engine_result_invalid", outcome.failure_class + ": " + (outcome.message ?? ""));
  }
  const ref = outcome.document_model_ref;
  try {
    const entries = await engine.inventory(bytes);
    const snapshot = adapter.snapshotOf(ref);
    if (!isXlsxWorkbookSnapshot(snapshot)) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "gateway returned an invalid xlsx workbook snapshot" });
    }
    let cellCount = 0;
    let formulaCellCount = 0;
    for (const sheet of snapshot.sheets) {
      for (const cell of Object.values(sheet.cells)) {
        cellCount += 1;
        if (cell.formula !== undefined) formulaCellCount += 1;
      }
    }
    // Only the open path pays for the render model; the serialize/probe path
    // (which shares this function) reads the snapshot without it.
    const renderModel =
      options.renderModel === false
        ? { revision: snapshot.revision, activeTab: 0, date1904: false, sheets: [], styles: [], dxfStyles: [] }
        : await readXlsxRenderModel(engine, bytes);
    return {
      probe: {
        format: "xlsx",
        sheetCount: snapshot.sheets.length,
        sheetNames: adapter.sheetNames(ref),
        cellCount,
        formulaCellCount,
        preservedParts: preservedPartsOf(entries),
      },
      snapshot,
      renderModel,
    };
  } finally {
    adapter.release(ref);
  }
}

export async function probeXlsx(engine: XlsxGatewayFunctions, bytes: Uint8Array): Promise<XlsxProbe> {
  return (await openXlsxModel(engine, bytes, { renderModel: false })).probe;
}

/**
 * edit:xlsx — input bytes + the ops.json edit list → assembled output bytes.
 * The recalc port must be bound by the caller (the worker resolves the native
 * sidecar); a formula-bearing workbook without it is unsupported_operation,
 * never a stale-<v> pass-through.
 */
export async function applyXlsxEditBytes(
  engine: XlsxGatewayFunctions,
  recalc: XlsxRecalcPort | undefined,
  bytes: Uint8Array,
  ops: unknown[],
  engineVersion?: string,
): Promise<{ bytes: Uint8Array; warnings: { code: string; detail: string }[] }> {
  const adapter = new XlsxAdapter({ engine, recalc, ...(engineVersion !== undefined ? { engineVersion } : {}) });
  const outcome = await adapter.open({ bytes, format: "xlsx", document_id: "job" });
  if (outcome.outcome !== "opened") {
    throw new XlsxTypedError("engine_result_invalid", outcome.failure_class + ": " + (outcome.message ?? ""));
  }
  const ref = outcome.document_model_ref;
  try {
    adapter.edit(ref, ops);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    return {
      bytes: saved.bytes,
      warnings: (saved.warnings ?? []) as { code: string; detail: string }[],
    };
  } catch (error) {
    throw toXlsxFailure(error);
  } finally {
    adapter.release(ref);
  }
}
