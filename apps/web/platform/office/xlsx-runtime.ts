"use client";

import { cancelOfficeJob, downloadOfficeJobOutput, getOfficeJob, startOfficeJob, type OfficeEditOp } from "@uniwork/core/api/endpoints/office";
import { isXlsxWorkbookSnapshot, parseXlsxOps, type XlsxEditOp, type XlsxRenderModel, type XlsxWorkbookSnapshot, type XlsxCellState } from "@uniwork/office-engine/xlsx";
import type { XlsxRuntimeOpenResult, XlsxRuntimeSerializedOutput, XlsxSessionRuntime } from "./xlsx-adapter";
import { cloneSnapshot, stableJson } from "./xlsx-adapter-data";

/** Loose guard for the additive render_model the G3-05c open job carries. */
function isRenderModel(value: unknown): value is XlsxRenderModel {
  if (!value || typeof value !== "object") return false;
  const sheets = (value as { sheets?: unknown }).sheets;
  return Array.isArray(sheets) && (value as { styles?: unknown }).styles !== undefined;
}

const JOB_TIMEOUT_MS = 120_000;

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("xlsx_checksum_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

// The gateway value snapshot has no style fields. Keep serializable deltas on
// cells so protected drafts can rebuild exactly the same server edit jobs.
interface DraftCell extends XlsxCellState { style?: Record<string, unknown>; styleReset?: boolean; }

function parsedEdits(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxEditOp[] {
  return parseXlsxOps([...operations], {
    sheetNames: () => base.sheets.map((sheet) => sheet.name),
    nameForId: (id) => base.sheets.find((sheet) => sheet.id === id)?.name,
  });
}

function applyEdits(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxWorkbookSnapshot {
  const ops = parsedEdits(base, operations);
  const next = cloneSnapshot(base);
  for (const op of ops) {
    const cells = next.sheets.find((sheet) => sheet.name === op.target.sheetName)!.cells as Record<string, DraftCell>;
    const previous = cells[op.target.address];
    const content: XlsxCellState = op.kind === "clear_cell" ? { value: null } : op.writeValue ? op.cell : previous ?? { value: null };
    const reset = op.kind === "set_cell" && op.styleReset;
    const style = { ...(reset ? {} : previous?.style), ...(op.kind === "set_cell" ? op.style : {}) };
    const cell: DraftCell = { value: content.value, ...(content.formula === undefined ? {} : { formula: content.formula }), ...(content.rawValue === undefined ? {} : { rawValue: content.rawValue }), ...(Object.keys(style).length ? { style } : {}), ...((reset || previous?.styleReset) ? { styleReset: true } : {}) };
    if (cell.value === null && cell.formula === undefined && !cell.style && !cell.styleReset) delete cells[op.target.address];
    else cells[op.target.address] = cell;
  }
  return { revision: base.revision + 1, sheets: next.sheets };
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
      if (signal?.aborted) { await cancelOfficeJob(options.documentId, jobId).catch(() => undefined); throw new DOMException("office job cancelled", "AbortError"); }
      if (Date.now() >= deadline) { await cancelOfficeJob(options.documentId, jobId).catch(() => undefined); throw new Error("office_job_timeout"); }
      await sleep(100);
      job = await getOfficeJob(options.documentId, jobId, signal);
    }
    if (!job) throw new Error("office_job_malformed");
    if (job.state !== "completed") throw new Error(job.error?.reason ?? job.error?.code ?? "office_job_failed");
    return job;
  }

  async function openModel(signal?: AbortSignal): Promise<{ snapshot: XlsxWorkbookSnapshot; renderModel?: XlsxRenderModel }> {
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
    return { snapshot: candidate, ...(isRenderModel(renderModel) ? { renderModel } : {}) };
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
