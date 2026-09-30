"use client";

import { cancelOfficeJob, downloadOfficeJobOutput, getOfficeJob, startOfficeJob, type OfficeEditOp } from "@uniwork/core/api/endpoints/office";
import { isXlsxWorkbookSnapshot, type XlsxRecalcResult, type XlsxWorkbookSnapshot, type XlsxCellState } from "@uniwork/office-engine/xlsx";
import type { XlsxRuntimeOpenResult, XlsxRuntimeSerializedOutput, XlsxSessionRuntime } from "./xlsx-adapter";

const JOB_TIMEOUT_MS = 120_000;

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("xlsx_checksum_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function cloneSnapshot(value: XlsxWorkbookSnapshot): XlsxWorkbookSnapshot {
  return { revision: value.revision, sheets: value.sheets.map((s) => ({ ...s, cells: Object.fromEntries(Object.entries(s.cells).map(([a, c]) => [a, { ...c }])) })) };
}

function parseTypedText(text: string): XlsxCellState {
  if (text.startsWith("=")) return { value: null, formula: text };
  if (text === "") return { value: null };
  if (text === "TRUE" || text === "FALSE") return { value: text === "TRUE" };
  const number = Number(text);
  return text.trim() !== "" && Number.isFinite(number) ? { value: number } : { value: text };
}

function applyEdits(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxWorkbookSnapshot {
  const next = cloneSnapshot(base);
  for (const raw of operations) {
    if (!raw || typeof raw !== "object") throw new Error("xlsx_edit_invalid");
    const op = raw as { op?: unknown; target?: { sheet?: unknown; cell?: unknown }; text?: unknown; attributes?: { value?: unknown; formula?: unknown } };
    if (typeof op.op !== "string" || typeof op.target?.sheet !== "string" || typeof op.target.cell !== "string") throw new Error("xlsx_edit_target_invalid");
    const sheet = next.sheets.find((s) => s.name === op.target?.sheet);
    if (!sheet) throw new Error("xlsx_edit_unknown_sheet");
    const cells = sheet.cells as Record<string, XlsxCellState>;
    if (op.op === "clear_cell") delete cells[op.target.cell];
    else if (op.op === "set_cell") {
      const attrs = op.attributes;
      cells[op.target.cell] = attrs?.formula !== undefined
        ? { value: null, formula: String(attrs.formula) }
        : attrs?.value !== undefined
          ? { value: attrs.value as XlsxCellState["value"] }
          : parseTypedText(typeof op.text === "string" ? op.text : "");
    } else throw new Error("xlsx_edit_unsupported");
  }
  return { revision: base.revision + 1, sheets: next.sheets };
}

export interface WebXlsxRuntimeOptions { documentId: string; baseRevision: string; onBaseRevision?: (revision: string) => void; }

export function createWebXlsxSessionRuntime(options: WebXlsxRuntimeOptions): XlsxSessionRuntime {
  let baseRevision = options.baseRevision;
  let snapshot: XlsxWorkbookSnapshot | null = null;
  let bytes: Uint8Array | null = null;
  let pending: unknown[] = [];
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

  async function openModel(signal?: AbortSignal): Promise<XlsxWorkbookSnapshot> {
    const started = await startOfficeJob(options.documentId, { operation: "open", format: "xlsx", base_revision: baseRevision }, { idempotencyKey: `xlsx-open-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`, signal });
    if (!started) throw new Error("office_open_job_malformed");
    activeJob = started.jobId;
    const job = await waitForJob(started.jobId, signal);
    const raw = await (await downloadOfficeJobOutput(options.documentId, job.jobId, signal)).text();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("office_open_snapshot_invalid"); }
    const candidate = value && typeof value === "object" ? (value as { snapshot?: unknown }).snapshot : undefined;
    if (!isXlsxWorkbookSnapshot(candidate)) throw new Error("office_open_snapshot_invalid");
    return candidate;
  }

  async function runServerEdit(edits: readonly unknown[], signal?: AbortSignal): Promise<Uint8Array> {
    const started = await startOfficeJob(options.documentId, { operation: "edit", format: "xlsx", base_revision: baseRevision, edits: edits as OfficeEditOp[] }, { idempotencyKey: `xlsx-edit-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`, signal });
    if (!started) throw new Error("office_edit_job_malformed");
    activeJob = started.jobId;
    const job = await waitForJob(started.jobId, signal);
    return new Uint8Array(await (await downloadOfficeJobOutput(options.documentId, job.jobId, signal)).arrayBuffer());
  }

  return {
    async open(input): Promise<XlsxRuntimeOpenResult> {
      if (disposed) throw new Error("xlsx_runtime_disposed");
      try { snapshot = await openModel(); return { outcome: "opened", document_id: input.documentId, document_model_ref: `web-xlsx-${input.documentId}`, snapshot }; }
      catch (error) { return { outcome: "failed", document_id: input.documentId, failure_class: "engine_error", message: error instanceof Error ? error.message : String(error) }; }
    },
    async edit(_ref, operations) { if (!snapshot) throw new Error("xlsx_runtime_not_open"); snapshot = applyEdits(snapshot, operations); pending.push(...operations); },
    snapshot() { if (!snapshot) throw new Error("xlsx_runtime_not_open"); return cloneSnapshot(snapshot); },
    async restore(_ref, recovered) { snapshot = cloneSnapshot(recovered); },
    async serialize() { if (!snapshot) throw new Error("xlsx_runtime_not_open"); const output = await runServerEdit(pending); bytes = output; pending = []; return { bytes: output, checksum: await sha256(output) } satisfies XlsxRuntimeSerializedOutput; },
    async recalculate(_ref, signal, onProgress): Promise<XlsxRecalcResult> { if (!snapshot) throw new Error("xlsx_runtime_not_open"); onProgress?.(5); bytes = await runServerEdit(pending, signal); onProgress?.(100); return { cells: [], cached: false }; },
    async cancelRecalculate() { if (activeJob) await cancelOfficeJob(options.documentId, activeJob).catch(() => undefined); },
    async release() { disposed = true; snapshot = null; bytes = null; pending = []; activeJob = null; },
    setBaseRevision(revision: string) { baseRevision = revision; options.onBaseRevision?.(revision); },
  } as XlsxSessionRuntime & { setBaseRevision(revision: string): void };
}
