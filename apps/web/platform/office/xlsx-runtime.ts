"use client";

import { cancelOfficeJob, downloadOfficeJobOutput, getOfficeJob, startOfficeJob, type OfficeEditOp, type OfficeJobError } from "@uniwork/core/api/endpoints/office";
import { dispatchOfficeError } from "@uniwork/core/office";
import { isXlsxFilterOp, isXlsxPageSetupOp, isXlsxSheetOp, isXlsxStructuralOp, isXlsxWorkbookSnapshot, parseXlsxOps, type XlsxEditOp, type XlsxRenderModel, type XlsxSheetOp, type XlsxWorkbookSnapshot, type XlsxWorksheet, type XlsxCellState } from "@uniwork/office-engine/xlsx";
import type { XlsxRuntimeOpenResult, XlsxRuntimeSerializedOutput, XlsxSessionRuntime } from "./xlsx-adapter";
import { cloneSnapshot, stableJson } from "./xlsx-adapter-data";

/** Required renderer fields: an older engine must fail clearly instead of
 * silently mounting the legacy value-only table. */
function isRenderModel(value: unknown): value is XlsxRenderModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<XlsxRenderModel>;
  return Number.isSafeInteger(model.revision) && Number.isSafeInteger(model.activeTab) &&
    typeof model.date1904 === "boolean" && Array.isArray(model.styles) && Array.isArray(model.dxfStyles) &&
    [...model.styles, ...model.dxfStyles].every((style) => style !== null && typeof style === "object") &&
    Array.isArray(model.sheets) && model.sheets.length > 0 && model.sheets.every((sheet) =>
      sheet !== null && typeof sheet === "object" && typeof sheet.id === "string" && typeof sheet.name === "string" &&
      Number.isSafeInteger(sheet.rowCount) && sheet.rowCount > 0 && Number.isSafeInteger(sheet.columnCount) && sheet.columnCount > 0 &&
      sheet.cells !== null && typeof sheet.cells === "object" && !Array.isArray(sheet.cells) &&
      Array.isArray(sheet.merges) && Array.isArray(sheet.columnWidths) && Array.isArray(sheet.rowsMeta) && Array.isArray(sheet.hyperlinks));
}

const JOB_TIMEOUT_MS = 120_000;
// At most 61 GETs in any minute, leaving headroom under the 300/min API
// budget for submission, cancellation and the rest of the document host.
const JOB_POLL_MS = 1_000;

function jobError(native: OfficeJobError): Error {
  const rule = dispatchOfficeError({ code: native.code });
  const known = rule.retryable || (rule.action !== "stop" && !rule.ambiguous);
  return Object.assign(new Error(native.reason ?? native.code), {
    ...native,
    nativeCode: native.code,
    // Transport ambiguity aliases are not native engine rules. A future
    // native code with one of those names must still terminally refuse.
    code: !known && rule.ambiguous ? "office_unknown_error" : native.code,
    // A raw native kind (e.g. malformed_result) is not an Office error class.
    // Unknown codes must not cause automatic attempts via the raw true flag.
    retryable: known && native.retryable,
    errorClass: known && native.code.startsWith("engine_") ? "engine" : "unknown",
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("xlsx_checksum_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("office job cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// The gateway value snapshot has no style fields. Keep serializable deltas on
// cells so protected drafts can rebuild exactly the same server edit jobs.
interface DraftCell extends XlsxCellState { style?: Record<string, unknown>; styleReset?: boolean; }

/** Deterministic id for a sheet added to the client snapshot (the server part
 *  is named by the plan's additions; the local id only keys the tab strip). */
function freshSheetId(sheets: readonly XlsxWorksheet[]): string {
  const used = new Set(sheets.map((sheet) => sheet.id));
  for (let n = 1; ; n += 1) {
    const id = `sheet-added-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Applies one sheet op to the client snapshot, in emission order (the same
 *  ordering rule as the engine session model): a rename makes later ops
 *  address the new name, additions land at their final index and removals
 *  drop the sheet, so the tab strip mirrors what the renderer shows. */
function applySheetOp(sheets: XlsxWorksheet[], op: XlsxSheetOp): void {
  switch (op.kind) {
    case "add_sheet":
      sheets.splice(op.index ?? sheets.length, 0, { id: freshSheetId(sheets), name: op.name, cells: {}, hidden: false });
      return;
    case "duplicate_sheet": {
      const source = sheets.find((sheet) => sheet.name === op.sheetName);
      if (!source) throw new Error("xlsx_edit_unknown_sheet");
      sheets.splice(op.index ?? sheets.length, 0, {
        id: freshSheetId(sheets), name: op.name, cells: structuredClone(source.cells), hidden: false,
      });
      return;
    }
    case "rename_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets[index] = { ...sheets[index]!, name: op.newName };
      return;
    }
    case "remove_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets.splice(index, 1);
      return;
    }
    case "reorder_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      const [sheet] = sheets.splice(index, 1);
      sheets.splice(op.index, 0, sheet!);
      return;
    }
    case "set_sheet_hidden": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets[index] = { ...sheets[index]!, hidden: op.hidden };
      return;
    }
  }
}

/** Apply one parsed op to the working sheet list. Structural ops reshape
 *  rows/columns, which this cell-content snapshot does not model: they ride
 *  the envelope to the server's structuralOps pass unapplied here (the
 *  renderer grid has already shifted what the user sees, and the server
 *  replays the shift before any cell edit). Filter snapshots are declarative
 *  sheet state the snapshot does not carry: they ride the envelope to the
 *  server's filterStates pass unapplied here as well. Page-setup snapshots are
 *  the same kind of declarative sheet state (print settings, not cell data),
 *  so they ride the envelope to the server's pageSetupStates pass unapplied. */
function applyOp(sheets: XlsxWorksheet[], op: XlsxEditOp): void {
  if (isXlsxSheetOp(op)) {
    applySheetOp(sheets, op);
    return;
  }
  if (isXlsxStructuralOp(op)) return;
  if (isXlsxFilterOp(op)) return;
  if (isXlsxPageSetupOp(op)) return;
  const cells = sheets.find((sheet) => sheet.name === op.target.sheetName)!.cells as Record<string, DraftCell>;
  const previous = cells[op.target.address];
  const content: XlsxCellState = op.kind === "clear_cell" ? { value: null } : op.writeValue ? op.cell : previous ?? { value: null };
  const reset = op.kind === "set_cell" && op.styleReset;
  const style = { ...(reset ? {} : previous?.style), ...(op.kind === "set_cell" ? op.style : {}) };
  const cell: DraftCell = { value: content.value, ...(content.formula === undefined ? {} : { formula: content.formula }), ...(content.rawValue === undefined ? {} : { rawValue: content.rawValue }), ...(Object.keys(style).length ? { style } : {}), ...((reset || previous?.styleReset) ? { styleReset: true } : {}) };
  if (cell.value === null && cell.formula === undefined && !cell.style && !cell.styleReset) delete cells[op.target.address];
  else cells[op.target.address] = cell;
}

/** Parse and apply interleaved, in emission order: a sheet rename must take
 *  effect before the next op's target resolves (the resolver is a live view
 *  over the working sheet list), exactly as the engine session model does. */
function applyEdits(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxWorkbookSnapshot {
  const next = cloneSnapshot(base);
  const sheets = next.sheets as XlsxWorksheet[];
  parseXlsxOps([...operations], {
    sheetNames: () => sheets.map((sheet) => sheet.name),
    nameForId: (id) => sheets.find((sheet) => sheet.id === id)?.name,
  }, (op) => applyOp(sheets, op));
  return { revision: base.revision + 1, sheets };
}

function snapshotsEqual(left: XlsxCellState | undefined, right: XlsxCellState | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.value === right.value && left.formula === right.formula && left.rawValue === right.rawValue;
}

/** Convert a recovered full snapshot back to the bounded public edit shape.
 * The server edit job is the only serializer/recalc path, so restoring a
 * draft must rebuild its queued edits before the next explicit Save. */
function editsBetween(base: XlsxWorkbookSnapshot, next: XlsxWorkbookSnapshot): unknown[] {
  const operations: unknown[] = [];
  const baseSheets = new Map(base.sheets.map((sheet) => [sheet.name, sheet]));
  for (const sheet of next.sheets) {
    const previous = baseSheets.get(sheet.name);
    const previousCells = previous?.cells ?? {};
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const previousCell = previousCells[address] as DraftCell | undefined;
      const nextCell = cell as DraftCell;
      const contentChanged = !snapshotsEqual(previousCell, nextCell);
      const styleChanged = JSON.stringify(previousCell?.style) !== JSON.stringify(nextCell.style) || previousCell?.styleReset !== nextCell.styleReset;
      if (!contentChanged && !styleChanged) continue;
      const attributes = { ...(contentChanged ? cell.formula !== undefined ? { formula: cell.formula } : { value: cell.value } : {}), ...(styleChanged && nextCell.styleReset ? { styleReset: true } : {}) };
      operations.push({
        op: "set_cell",
        target: { sheet: sheet.name, cell: address },
        ...(Object.keys(attributes).length ? { attributes } : {}),
        ...(styleChanged && nextCell.style !== undefined ? { style: nextCell.style } : {}),
      });
    }
    for (const address of Object.keys(previousCells)) {
      if (!(address in sheet.cells)) operations.push({ op: "clear_cell", target: { sheet: sheet.name, cell: address } });
    }
  }
  return operations;
}

export interface WebXlsxRuntimeOptions { documentId: string; baseRevision: string; onBaseRevision?: (revision: string) => void; }

export function createWebXlsxSessionRuntime(options: WebXlsxRuntimeOptions): XlsxSessionRuntime {
  let baseRevision = options.baseRevision;
  let snapshot: XlsxWorkbookSnapshot | null = null;
  let committed: XlsxWorkbookSnapshot | null = null;
  let pending: { revision: number; operation: unknown }[] = [];
  let lastCommit: { intentId: string; revision: string } | null = null;
  const candidates = new Map<string, { baseRevision: string; snapshot: XlsxWorkbookSnapshot; operations: OfficeEditOp[]; output?: XlsxRuntimeSerializedOutput; running?: Promise<XlsxRuntimeSerializedOutput> }>();
  let activeJob: string | null = null;
  let disposed = false;

  async function waitForJob(jobId: string, signal?: AbortSignal) {
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let job = await getOfficeJob(options.documentId, jobId, signal);
    while (job && (job.state === "accepted" || job.state === "running")) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) {
        await cancelOfficeJob(options.documentId, jobId).catch(() => undefined);
        throw jobError({ code: "engine_timeout", reason: "office_job_timeout", kind: "host_polling_deadline", retryable: true });
      }
      await sleep(Math.min(JOB_POLL_MS, deadline - Date.now()), signal);
      if (Date.now() >= deadline) continue;
      job = await getOfficeJob(options.documentId, jobId, signal);
    }
    signal?.throwIfAborted();
    if (!job) throw new Error("office_job_malformed");
    if (job.state === "cancelled") throw new DOMException(job.error?.reason ?? "office job cancelled", "AbortError");
    if (job.state !== "completed") throw jobError(job.error ?? { code: "office_job_failed", reason: null, kind: null, retryable: false });
    return job;
  }

  async function openModel(signal?: AbortSignal): Promise<{ snapshot: XlsxWorkbookSnapshot; renderModel: XlsxRenderModel }> {
    const started = await startOfficeJob(options.documentId, { operation: "open", format: "xlsx", base_revision: baseRevision }, { idempotencyKey: `xlsx-open-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`, signal });
    if (!started) throw new Error("office_open_job_malformed");
    activeJob = started.jobId;
    const job = await waitForJob(started.jobId, signal);
    const raw = await (await downloadOfficeJobOutput(options.documentId, job.jobId, signal)).text();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("office_open_snapshot_invalid"); }
    const candidate = value && typeof value === "object" ? (value as { snapshot?: unknown }).snapshot : undefined;
    if (!isXlsxWorkbookSnapshot(candidate)) throw new Error("office_open_snapshot_invalid");
    const renderModel = value && typeof value === "object" ? (value as { render_model?: unknown }).render_model : undefined;
    if (!isRenderModel(renderModel)) throw new Error("office_open_render_model_invalid");
    return { snapshot: candidate, renderModel };
  }

  async function runServerEdit(edits: OfficeEditOp[], revision: string, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const started = await startOfficeJob(options.documentId, { operation: "edit", format: "xlsx", base_revision: revision, edits: structuredClone(edits) }, { idempotencyKey: `xlsx-edit-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`, signal });
    if (!started) throw new Error("office_edit_job_malformed");
    activeJob = started.jobId;
    try {
      signal?.throwIfAborted();
      const job = await waitForJob(started.jobId, signal);
      const bytes = new Uint8Array(await (await downloadOfficeJobOutput(options.documentId, job.jobId, signal)).arrayBuffer());
      signal?.throwIfAborted();
      return bytes;
    } catch (error) {
      if (signal?.aborted) await cancelOfficeJob(options.documentId, started.jobId).catch(() => undefined);
      throw error;
    } finally { if (activeJob === started.jobId) activeJob = null; }
  }

  return {
    async open(input): Promise<XlsxRuntimeOpenResult> {
      if (disposed) throw new Error("xlsx_runtime_disposed");
      try {
        const opened = await openModel();
        snapshot = cloneSnapshot(opened.snapshot);
        committed = cloneSnapshot(snapshot);
        return {
          outcome: "opened",
          document_id: input.documentId,
          document_model_ref: `web-xlsx-${input.documentId}`,
          snapshot: cloneSnapshot(snapshot),
          ...(opened.renderModel === undefined ? {} : { renderModel: opened.renderModel }),
        };
      } catch (error) { return { outcome: "failed", document_id: input.documentId, failure_class: "engine_error", message: error instanceof Error ? error.message : String(error) }; }
    },
    async edit(_ref, operations) {
      if (!snapshot) throw new Error("xlsx_runtime_not_open");
      const copied = structuredClone(operations);
      snapshot = applyEdits(snapshot, copied);
      pending.push(...copied.map((operation) => ({ revision: snapshot!.revision, operation })));
    },
    snapshot() { if (!snapshot) throw new Error("xlsx_runtime_not_open"); return cloneSnapshot(snapshot); },
    async restore(_ref, recovered) {
      if (!snapshot || !committed) throw new Error("xlsx_runtime_not_open");
      if (candidates.size) throw new Error("xlsx_restore_save_pending");
      const restored = { ...cloneSnapshot(recovered), revision: snapshot.revision + 1 };
      pending = editsBetween(committed, restored).map((operation) => ({ revision: restored.revision, operation }));
      snapshot = restored;
    },
    async serialize(_ref, input) {
      if (!snapshot || !committed) throw new Error("xlsx_runtime_not_open");
      input.signal?.throwIfAborted();
      let candidate = candidates.get(input.intentId);
      if (!candidate) {
        if (input.snapshot.value.revision < committed.revision || input.snapshot.value.revision > snapshot.revision) throw new Error("xlsx_save_snapshot_invalid");
        const prefix = pending.filter((entry) => entry.revision <= input.snapshot.value.revision).map((entry) => entry.operation);
        if (stableJson(applyEdits(committed, prefix).sheets) !== stableJson(input.snapshot.value.sheets)) throw new Error("xlsx_save_snapshot_invalid");
        candidate = { baseRevision, snapshot: cloneSnapshot(input.snapshot.value), operations: structuredClone(prefix) as OfficeEditOp[] };
        candidates.set(input.intentId, candidate);
      }
      if (candidate.baseRevision !== baseRevision) throw new Error("xlsx_save_base_changed");
      const captured = candidate;
      if (!captured.output && !captured.running) {
        captured.running = (async () => {
          const output = await runServerEdit(captured.operations, captured.baseRevision, input.signal);
          const checksum = await sha256(output);
          input.signal?.throwIfAborted();
          if (disposed) throw new Error("xlsx_runtime_disposed");
          captured.output = { bytes: output, checksum };
          return captured.output;
        })();
      }
      try {
        const output = captured.output ?? await captured.running!;
        return { ...output, bytes: output.bytes.slice() };
      } finally { captured.running = undefined; }
    },
    async release() {
      disposed = true;
      if (activeJob) await cancelOfficeJob(options.documentId, activeJob).catch(() => undefined);
      snapshot = null; committed = null; pending = []; candidates.clear(); activeJob = null;
    },
    setBaseRevision(revision, intentId) {
      if (lastCommit?.intentId === intentId && lastCommit.revision === revision) return;
      const candidate = candidates.get(intentId);
      if (!candidate?.output || candidate.baseRevision !== baseRevision) throw new Error("xlsx_commit_candidate_missing");
      if (!/^\d+$/.test(revision) || BigInt(revision) <= BigInt(baseRevision)) throw new Error("xlsx_commit_revision_invalid");
      committed = cloneSnapshot(candidate.snapshot);
      pending = pending.filter((entry) => entry.revision > candidate.snapshot.revision);
      baseRevision = revision;
      lastCommit = { intentId, revision };
      candidates.clear();
      options.onBaseRevision?.(revision);
    },
  };
}
