"use client";

import { cancelOfficeJob, downloadOfficeJobOutput, getOfficeJob, startOfficeJob, type OfficeEditOp, type OfficeJobError } from "@uniwork/core/api/endpoints/office";
import { dispatchOfficeError } from "@uniwork/core/office";
import { isXlsxWorkbookSnapshot, type XlsxRenderModel, type XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxRuntimeOpenResult, XlsxRuntimeSerializedOutput, XlsxSessionRuntime } from "./xlsx-adapter";
import { cloneSnapshot, stableJson } from "./xlsx-adapter-data";
import { applyXlsxJournalToSnapshot, diffXlsxSnapshotsToOperations, withPendingOps, withoutPendingOps } from "@uniwork/views/office/xlsx";

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

/** Shared, host-neutral journal application (@uniwork/views/office/xlsx).
 *  Web and desktop must apply the same ops the same way so the save envelope
 *  is identical across hosts; the implementation lives in the views package. */
function applyEdits(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxWorkbookSnapshot {
  return applyXlsxJournalToSnapshot(base, operations);
}

function editsBetween(base: XlsxWorkbookSnapshot, next: XlsxWorkbookSnapshot): unknown[] {
  return diffXlsxSnapshotsToOperations(base, next);
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
        snapshot = withoutPendingOps(cloneSnapshot(opened.snapshot));
        committed = withoutPendingOps(cloneSnapshot(snapshot));
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
      const operations = editsBetween(committed, restored);
      pending = operations.map((operation) => ({ revision: restored.revision, operation }));
      // F4: the recovered draft re-emits the ops it carries; keep that stream
      // on the snapshot so a further interruption still recovers them.
      snapshot = operations.length === 0 ? withoutPendingOps(restored) : withPendingOps(restored, operations);
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
    releaseSave(intentId) { candidates.delete(intentId); },
    setBaseRevision(revision, intentId) {
      if (lastCommit?.intentId === intentId && lastCommit.revision === revision) return;
      const candidate = candidates.get(intentId);
      if (!candidate?.output || candidate.baseRevision !== baseRevision) throw new Error("xlsx_commit_candidate_missing");
      if (!/^\d+$/.test(revision) || BigInt(revision) <= BigInt(baseRevision)) throw new Error("xlsx_commit_revision_invalid");
      // F4: the committed base is the file the save just wrote, so it carries
      // no pending stream; the live snapshot drops the ops it just saved.
      committed = withoutPendingOps(cloneSnapshot(candidate.snapshot));
      snapshot = snapshot === null ? null : withoutPendingOps(snapshot);
      pending = pending.filter((entry) => entry.revision > candidate.snapshot.revision);
      baseRevision = revision;
      lastCommit = { intentId, revision };
      candidates.clear();
      options.onBaseRevision?.(revision);
    },
  };
}
