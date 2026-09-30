"use client";

import {
  cancelOfficeJob,
  downloadOfficeJobOutput,
  getOfficeJob,
  startOfficeJob,
  type OfficeEditOp,
} from "@uniwork/core/api/endpoints/office";
import { downloadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import type { XlsxRecalcResult, XlsxWorkbookSnapshot, XlsxCellState } from "@uniwork/office-engine/xlsx";
import type { XlsxRuntimeOpenResult, XlsxRuntimeSerializedOutput, XlsxSessionRuntime } from "./xlsx-adapter";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const JOB_TIMEOUT_MS = 120_000;

function bytesFromBlob(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("xlsx_checksum_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function u16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number): number { return view.getUint32(offset, true); }

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("xlsx_zip_inflate_unavailable");
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal ZIP reader for browser parsing. It never rewrites a package: native
 * server edit jobs produce the saved bytes, so unknown chart/pivot/macro parts
 * remain under the Go/FileService preservation guard. */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let p = bytes.byteLength - 22; p >= Math.max(0, bytes.byteLength - 65_557); p -= 1) {
    if (u32(view, p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("xlsx_zip_eocd_missing");
  const count = u16(view, eocd + 10);
  const centralOffset = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.byteLength || u32(view, cursor) !== 0x02014b50) throw new Error("xlsx_zip_central_invalid");
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (localOffset + 30 > bytes.byteLength || u32(view, localOffset) !== 0x04034b50) throw new Error("xlsx_zip_local_invalid");
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > bytes.byteLength) throw new Error("xlsx_zip_entry_bounds");
    const compressed = bytes.subarray(start, end);
    const value = method === 0 ? new Uint8Array(compressed) : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error("xlsx_zip_method_unsupported"); })();
    out.set(name, value);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function parseXml(bytes: Uint8Array): Document {
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("xlsx_xml_invalid");
  return xml;
}

function localAttribute(element: Element, name: string): string | null {
  return element.getAttribute(name) ?? [...element.attributes].find((a) => a.localName === name)?.value ?? null;
}

function sharedStrings(entries: Map<string, Uint8Array>): string[] {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [];
  const doc = parseXml(bytes);
  return [...doc.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""));
}

function cellValue(cell: Element, strings: readonly string[]): XlsxCellState {
  const type = localAttribute(cell, "t");
  const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  let value: string | number | boolean | null = raw;
  if (type === "s") value = strings[Number(raw)] ?? "";
  else if (type === "b") value = raw === "1";
  else if (type !== "str" && raw !== "" && Number.isFinite(Number(raw))) value = Number(raw);
  const formula = cell.getElementsByTagName("f")[0]?.textContent;
  return { value, ...(formula !== undefined ? { formula: `=${formula}` } : {}) };
}

async function snapshotFromBytes(bytes: Uint8Array): Promise<XlsxWorkbookSnapshot> {
  const entries = await unzip(bytes);
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("xlsx_workbook_missing");
  const wb = parseXml(workbook);
  const relsBytes = entries.get("xl/_rels/workbook.xml.rels");
  const rels = relsBytes ? parseXml(relsBytes) : null;
  const relPaths = new Map<string, string>();
  for (const rel of rels ? [...rels.getElementsByTagName("Relationship")] : []) {
    const id = localAttribute(rel, "Id");
    const target = localAttribute(rel, "Target");
    if (id && target) relPaths.set(id, target.replace(/^\/?/, "xl/").replace("xl//", "xl/"));
  }
  const strings = sharedStrings(entries);
  const sheets = [...wb.getElementsByTagName("sheet")].map((sheet, index) => {
    const name = localAttribute(sheet, "name") ?? `Sheet${index + 1}`;
    const relation = localAttribute(sheet, "id") ?? localAttribute(sheet, "r:id") ?? "";
    const path = relPaths.get(relation) ?? `xl/worksheets/sheet${index + 1}.xml`;
    const xml = entries.get(path);
    const cells: Record<string, XlsxCellState> = {};
    if (xml) {
      const worksheet = parseXml(xml);
      for (const cell of [...worksheet.getElementsByTagName("c")]) {
        const address = localAttribute(cell, "r");
        if (address) cells[address] = cellValue(cell, strings);
      }
    }
    return { id: `sheet-${index + 1}`, name, cells };
  });
  if (sheets.length === 0) throw new Error("xlsx_workbook_no_sheets");
  return { revision: 0, sheets };
}

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
    const sheet = next.sheets.find((s) => s.name === op.target?.sheet);
    const address = typeof op.target?.cell === "string" ? op.target.cell : null;
    if (!sheet || !address || typeof op.op !== "string") throw new Error("xlsx_edit_target_invalid");
    const cells = sheet.cells as Record<string, XlsxCellState>;
    if (op.op === "clear_cell") delete cells[address];
    else if (op.op === "set_cell") {
      const attrs = op.attributes;
      cells[address] = attrs?.formula !== undefined ? { value: null, formula: String(attrs.formula) } : attrs?.value !== undefined ? { value: attrs.value as XlsxCellState["value"] } : parseTypedText(typeof op.text === "string" ? op.text : "");
    } else throw new Error("xlsx_edit_unsupported");
  }
  return { revision: base.revision + 1, sheets: next.sheets };
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export interface WebXlsxRuntimeOptions {
  documentId: string;
  baseRevision: string;
  onBaseRevision?: (revision: string) => void;
}

export function createWebXlsxSessionRuntime(options: WebXlsxRuntimeOptions): XlsxSessionRuntime {
  let baseRevision = options.baseRevision;
  let snapshot: XlsxWorkbookSnapshot | null = null;
  let bytes: Uint8Array | null = null;
  let pending: unknown[] = [];
  let activeJob: string | null = null;
  let disposed = false;

  async function runServerEdit(edits: readonly unknown[], signal?: AbortSignal): Promise<{ bytes: Uint8Array; jobId: string }> {
    const idempotencyKey = `xlsx-edit-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    const started = await startOfficeJob(options.documentId, { operation: "edit", format: "xlsx", base_revision: baseRevision, edits: edits as OfficeEditOp[] }, { idempotencyKey, signal });
    if (!started) throw new Error("office_edit_job_malformed");
    activeJob = started.jobId;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let job = started;
    while (job.state === "accepted" || job.state === "running") {
      if (signal?.aborted) { await cancelOfficeJob(options.documentId, job.jobId).catch(() => undefined); throw new DOMException("recalculation cancelled", "AbortError"); }
      if (Date.now() >= deadline) { await cancelOfficeJob(options.documentId, job.jobId).catch(() => undefined); throw new Error("office_edit_timeout"); }
      await sleep(100);
      job = await getOfficeJob(options.documentId, started.jobId, signal) ?? job;
    }
    if (job.state !== "completed") throw new Error(job.error?.reason ?? job.error?.code ?? "office_edit_failed");
    const output = await downloadOfficeJobOutput(options.documentId, job.jobId, signal);
    return { bytes: await bytesFromBlob(output), jobId: job.jobId };
  }

  return {
    async open(input): Promise<XlsxRuntimeOpenResult> {
      if (disposed) throw new Error("xlsx_runtime_disposed");
      bytes = input.bytes;
      try {
        snapshot = await snapshotFromBytes(bytes);
        return { outcome: "opened", document_id: input.documentId, document_model_ref: `web-xlsx-${input.documentId}`, snapshot };
      } catch (error) {
        return { outcome: "failed", document_id: input.documentId, failure_class: "corrupted", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async edit(_ref, operations) {
      if (!snapshot) throw new Error("xlsx_runtime_not_open");
      snapshot = applyEdits(snapshot, operations);
      pending.push(...operations);
    },
    snapshot() { if (!snapshot) throw new Error("xlsx_runtime_not_open"); return cloneSnapshot(snapshot); },
    async restore(_ref, recovered) { snapshot = cloneSnapshot(recovered); },
    async serialize() {
      if (!bytes || !snapshot) throw new Error("xlsx_runtime_not_open");
      const result = await runServerEdit(pending);
      bytes = result.bytes;
      snapshot = await snapshotFromBytes(bytes);
      pending = [];
      const checksum = await sha256(bytes);
      return { bytes, checksum } satisfies XlsxRuntimeSerializedOutput;
    },
    async recalculate(_ref, signal, onProgress): Promise<XlsxRecalcResult> {
      if (!bytes || !snapshot) throw new Error("xlsx_runtime_not_open");
      onProgress?.(5);
      const result = await runServerEdit(pending, signal);
      onProgress?.(80);
      const parsed = await snapshotFromBytes(result.bytes);
      snapshot = parsed;
      onProgress?.(100);
      return { cells: [], cached: false };
    },
    async cancelRecalculate() { if (activeJob) await cancelOfficeJob(options.documentId, activeJob).catch(() => undefined); },
    async release() { disposed = true; snapshot = null; bytes = null; pending = []; activeJob = null; },
    setBaseRevision(revision: string) { baseRevision = revision; options.onBaseRevision?.(revision); },
  } as XlsxSessionRuntime & { setBaseRevision(revision: string): void };
}

export async function readXlsxDocumentBytes(documentId: string): Promise<Uint8Array> {
  return bytesFromBlob(await downloadDocumentFile(documentId));
}

export { snapshotFromBytes };
