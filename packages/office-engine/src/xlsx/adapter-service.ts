// XLSX adapter — the one-shot service seam (G2-02 job handlers). Split out of
// adapter.ts (FIX-926-B) so the adapter module stays under the max-lines
// budget; adapter.ts re-exports these names, so the module surface is
// unchanged.
//
// The office-engine service runs one-shot jobs: a handler reads the job's
// input.bin + ops.json, calls these, writes output.bin. Each call drives the
// full adapter path on a private session — probe/edit/serialize share one
// invariant implementation, so a service save is the same assemble+preserve+
// rebase the adapter performs. Every failure leaves here as XlsxTypedError
// with one of the worker's closed outcome codes.
import { EngineBoundaryError, HostCapabilityRefusal } from "@uniwork/office-contracts";
import { isXlsxWorkbookSnapshot, type XlsxGatewayFunctions, type XlsxRecalcPort, type XlsxWorkbookSnapshot } from "./engine.ts";
import { XlsxAdapter, XlsxProbe, preservedPartsOf, type XlsxAdapterDeps } from "./adapter.ts";
import { XlsxOpError } from "./ops.ts";
import { readXlsxRenderModel, type XlsxRenderModel } from "./render-model.ts";
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
