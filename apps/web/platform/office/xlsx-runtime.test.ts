/** @vitest-environment node */
import { inspect, types } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeSaveCoordinator, dispatchOfficeError, officeSerializedOutputSchema, officeUploadReceiptSchema, type EditorHandle, type OfficeIdentity, type OfficeSaveIntent, type StableSnapshot } from "@uniwork/core/office";
import type { OfficeJob } from "@uniwork/core/api/endpoints/office";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { createWebXlsxSessionRuntime } from "./xlsx-runtime";
import { createXlsxSaveTransport, type XlsxDocumentsTransport, type XlsxSessionRuntime } from "./xlsx-adapter";

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), download: vi.fn(), cancel: vi.fn() }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ startOfficeJob: api.start, getOfficeJob: api.get, downloadOfficeJobOutput: api.download, cancelOfficeJob: api.cancel }));

const workbook = (): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 4, formula: "=A1*2", rawValue: 4 } } }] });
const renderModel = () => ({ revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 }, B1: { f: "=A1*2", c: 4 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] });
const valueEdit = (value: number) => ({ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value } });
const styleEdit = { op: "set_cell", target: { sheet: "Data", cell: "B1" }, style: { bold: true } };
const stable = (engine: XlsxSessionRuntime): StableSnapshot<XlsxWorkbookSnapshot> => ({ generation: engine.snapshot("model").revision, fingerprint: "captured", value: engine.snapshot("model") });
const identity: OfficeIdentity = { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v1", baseRevision: "1" };
function intent(snapshot: StableSnapshot<XlsxWorkbookSnapshot>, id = "save-1", revision = "1"): OfficeSaveIntent<XlsxWorkbookSnapshot> {
  return { intentId: id, idempotencyKey: `office-key-${id}`, identity: { ...identity, baseRevision: revision }, snapshotGeneration: snapshot.generation, snapshotFingerprint: snapshot.fingerprint, snapshot: snapshot.value, operation: "manual_save", createdAt: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function opened() {
  const engine = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "1" });
  expect(await engine.open({ bytes: new Uint8Array([80, 75]), documentId: "doc" })).toMatchObject({ outcome: "opened" });
  return engine;
}
function editRequests() { return api.start.mock.calls.map((call) => call[1]).filter((body) => body.operation === "edit"); }

// Only the two controlled cancellation rejections use this seam. Log their
// original errors before rejects assertions consume them, never request bytes.
function logCancellation(error: unknown, phase: string): never {
  const record = error as Error & { code?: unknown; cause?: unknown };
  console.error("xlsx-original-cancellation", inspect({
    phase, constructor: record?.constructor?.name, tag: Object.prototype.toString.call(error),
    instanceOfGlobalError: error instanceof Error, nativeIsError: types.isNativeError(error),
    instanceOfDOMException: error instanceof DOMException,
    name: record?.name, message: record?.message, stack: record?.stack, code: record?.code,
    causePresent: !!record && Object.prototype.hasOwnProperty.call(record, "cause"), cause: record?.cause,
  }, { depth: null, maxArrayLength: null, maxStringLength: null, customInspect: false }));
  throw error;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.start.mockResolvedValue({ jobId: "job" });
  api.get.mockResolvedValue({ jobId: "job", state: "completed" } as OfficeJob);
  api.cancel.mockResolvedValue({});
  api.download.mockResolvedValue({ text: async () => JSON.stringify({ snapshot: workbook(), render_model: renderModel() }), arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("web XLSX save journal", () => {
  it.each([undefined, { sheets: [], styles: null }, { ...renderModel(), sheets: [{ id: "sheet-1" }] }])("refuses an absent or malformed renderer model instead of opening a table", async (render_model) => {
    api.download.mockResolvedValueOnce({ text: async () => JSON.stringify({ snapshot: workbook(), render_model }) });
    const engine = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "1" });
    expect(await engine.open({ bytes: new Uint8Array([80, 75]), documentId: "doc" })).toMatchObject({ outcome: "failed", failure_class: "engine_error", message: "office_open_render_model_invalid" });
  });
  it.each(["A1", "B1"])("preserves %s content for a style-only edit and checkpoints its style", async (cell) => {
    const engine = await opened();
    const original = engine.snapshot("model").sheets[0]!.cells[cell];
    const op = { ...styleEdit, target: { sheet: "Data", cell } };
    await engine.edit("model", [op]);
    const draft = stable(engine);
    expect(draft.value.sheets[0]!.cells[cell]).toMatchObject({ ...original, style: op.style });
    const restored = await opened();
    await restored.restore?.("model", JSON.parse(JSON.stringify(draft.value)) as XlsxWorkbookSnapshot);
    await restored.serialize("model", { intentId: "recovered", snapshot: stable(restored) });
    expect(editRequests().at(-1)?.edits).toContainEqual(op);
  });

  it("sends structural ops through the envelope without applying them to the cell snapshot", async () => {
    const engine = await opened();
    const insert = { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } };
    await engine.edit("model", [insert]);
    // The cell snapshot keeps its coordinates: the row shift reaches the
    // server's structuralOps pass, which replays before any cell edit; the
    // local snapshot models content only.
    expect(engine.snapshot("model").sheets[0]!.cells.A1?.value).toBe(2);
    await engine.serialize("model", { intentId: "save-1", snapshot: stable(engine) });
    expect(editRequests()[0]?.edits).toEqual([insert]);
  });

  it("captures the operation prefix before serialize and retains typing N+1 after commit", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    const saved = stable(engine);
    await engine.edit("model", [valueEdit(8)]);
    const output = deferred<ArrayBuffer>();
    api.download.mockResolvedValueOnce({ arrayBuffer: () => output.promise });
    const saving = engine.serialize("model", { intentId: "save-1", snapshot: saved });
    await vi.waitFor(() => expect(editRequests()).toHaveLength(1));
    expect(editRequests()[0].edits).toEqual([valueEdit(7), styleEdit]);
    await engine.edit("model", [valueEdit(9)]);
    output.resolve(new Uint8Array([80, 75, 3, 4]).buffer);
    await saving;
    engine.setBaseRevision?.("2", "save-1");
    expect(engine.snapshot("model").sheets[0]!.cells.A1?.value).toBe(9);
    await engine.serialize("model", { intentId: "save-2", snapshot: stable(engine) });
    expect(editRequests()[1]).toMatchObject({ base_revision: "2", edits: [valueEdit(8), valueEdit(9)] });
    engine.setBaseRevision?.("3", "save-2");
    await engine.serialize("model", { intentId: "save-3", snapshot: stable(engine) });
    expect(editRequests()[2]).toMatchObject({ base_revision: "3", edits: [] });
  });

  it("retries a failed serialization with the same frozen prefix", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7)]);
    const snapshot = stable(engine);
    api.start.mockRejectedValueOnce(new Error("office_job_failed"));
    await expect(engine.serialize("model", { intentId: "save-1", snapshot })).rejects.toThrow("office_job_failed");
    await engine.edit("model", [valueEdit(8)]);
    await engine.serialize("model", { intentId: "save-1", snapshot });
    expect(editRequests().map((body) => body.edits)).toEqual([[valueEdit(7)], [valueEdit(7)]]);
    expect(engine.snapshot("model").sheets[0]!.cells.A1?.value).toBe(8);
  });

  it.each(["upload", "commit"] as const)("retains edits through %s failure and reuses the candidate on retry", async (phase) => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    const snapshot = stable(engine);
    const saveIntent = intent(snapshot);
    let checksum = "";
    const files: XlsxDocumentsTransport = {
      read: vi.fn(),
      upload: vi.fn(async () => ({ upload_id: "upload-1", checksum_sha256: checksum, size_bytes: 4, claim_expires_at: "2027-01-01T00:00:00Z" })),
      commit: vi.fn(async () => ({ document: { id: "doc", revision: "2" }, version: { id: "v2", checksum_sha256: checksum, size_bytes: 4 } })),
    };
    vi.mocked(files[phase]).mockRejectedValueOnce(new Error(`${phase}_failed`));
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", runtime: engine, serialize: async (input) => {
      const result = await engine.serialize("model", input);
      checksum = result.checksum;
      return result;
    } });
    async function save() {
      const output = officeSerializedOutputSchema.parse(await transport.serialize({ intent: saveIntent, snapshot }));
      const upload = officeUploadReceiptSchema.parse(await transport.upload({ intent: saveIntent, output }));
      return transport.commit({ intent: saveIntent, upload });
    }
    await expect(save()).rejects.toThrow(`${phase}_failed`);
    await engine.edit("model", [valueEdit(8)]);
    await expect(save()).resolves.toMatchObject({ revision: "2" });
    expect(editRequests()).toHaveLength(1);
    await engine.serialize("model", { intentId: "save-2", snapshot: stable(engine) });
    expect(editRequests()[1]).toMatchObject({ base_revision: "2", edits: [valueEdit(8)] });
  });

  it("restores against the committed base while retaining earlier unsaved changes", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    await engine.restore?.("model", stable(engine).value);
    await engine.serialize("model", { intentId: "restored", snapshot: stable(engine) });
    expect(editRequests()[0].edits).toContainEqual(valueEdit(7));
    expect(editRequests()[0].edits).toContainEqual(styleEdit);
  });

  it("keeps caller mutations out of the pending operation journal", async () => {
    const engine = await opened();
    const op = valueEdit(7);
    await engine.edit("model", [op]);
    op.attributes.value = 99;
    await engine.serialize("model", { intentId: "save-1", snapshot: stable(engine) });
    expect(editRequests()[0].edits).toEqual([valueEdit(7)]);
  });

  it("does not advertise explicit recalc without a native result receipt", async () => {
    const engine = await opened();
    expect(engine.recalculate).toBeUndefined();
    expect(editRequests()).toHaveLength(0);
  });

  it("preserves a style reset and clear in protected draft recovery", async () => {
    const engine = await opened();
    await engine.edit("model", [styleEdit]);
    const reset = { op: "set_cell", target: styleEdit.target, attributes: { styleReset: true } };
    await engine.edit("model", [reset]);
    expect(engine.snapshot("model").sheets[0]?.cells.B1).toEqual({ value: 4, formula: "=A1*2", rawValue: 4, styleReset: true });
    await engine.edit("model", [{ op: "clear_cell", target: styleEdit.target }]);
    const restored = await opened();
    await restored.restore?.("model", stable(engine).value);
    await restored.serialize("model", { intentId: "recovered", snapshot: stable(restored) });
    expect(editRequests().at(-1)?.edits).toEqual([{ op: "set_cell", target: styleEdit.target, attributes: { value: null, styleReset: true } }]);
  });

  it("refuses a mismatched snapshot rather than retiring edits that were never serialized", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7)]);
    const captured = stable(engine);
    const bad = { ...captured, value: { ...captured.value, sheets: workbook().sheets } };
    await expect(engine.serialize("model", { intentId: "bad", snapshot: bad })).rejects.toThrow("xlsx_save_snapshot_invalid");
    expect(editRequests()).toHaveLength(0);
    await engine.serialize("model", { intentId: "good", snapshot: captured });
    expect(editRequests()[0].edits).toEqual([valueEdit(7)]);
  });

  it("advances the base after a reconciled commit and retains later edits", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    const snapshot = stable(engine);
    const saveIntent = intent(snapshot);
    const files: XlsxDocumentsTransport = { read: vi.fn(), upload: vi.fn(), commit: vi.fn(), reconcile: vi.fn() };
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", runtime: engine, serialize: (input) => engine.serialize("model", input) });
    const output = officeSerializedOutputSchema.parse(await transport.serialize({ intent: saveIntent, snapshot }));
    await engine.edit("model", [valueEdit(8)]);
    const receipt = { intentId: saveIntent.intentId, idempotencyKey: saveIntent.idempotencyKey, documentId: "doc", versionId: "v2", revision: "2", checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes, engineName: "genoffice", engineVersion: "test", contractVersion: "xlsx/1", protocolVersion: "1" };
    vi.mocked(files.reconcile!).mockResolvedValueOnce({ ...receipt, revision: "1" });
    expect(await transport.reconcile({ intent: saveIntent })).toBeNull();
    vi.mocked(files.reconcile!).mockResolvedValueOnce(receipt);
    expect(await transport.reconcile({ intent: saveIntent })).toEqual(receipt);
    engine.setBaseRevision?.("2", saveIntent.intentId);
    await engine.serialize("model", { intentId: "save-2", snapshot: stable(engine) });
    expect(editRequests()[1]).toMatchObject({ base_revision: "2", edits: [valueEdit(8)] });
  });

  it("keeps the immutable candidate through native timeout and checksum failure", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    const snapshot = stable(engine);
    api.get.mockResolvedValueOnce({ jobId: "job", state: "running" } as OfficeJob);
    const time = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(120_001);
    await expect(engine.serialize("model", { intentId: "save-1", snapshot })).rejects.toMatchObject({ code: "engine_timeout", errorClass: "engine" });
    time.mockRestore();
    expect(api.cancel).toHaveBeenCalledWith("doc", "job");
    await engine.edit("model", [valueEdit(8)]);
    vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(new Error("checksum_failed"));
    await expect(engine.serialize("model", { intentId: "save-1", snapshot })).rejects.toThrow("checksum_failed");
    await engine.serialize("model", { intentId: "save-1", snapshot });
    expect(editRequests().map((request) => request.edits)).toEqual(Array.from({ length: 3 }, () => [valueEdit(7), styleEdit]));
    expect(engine.snapshot("model").sheets[0]?.cells.A1?.value).toBe(8);
  });

  it("cancels native serialization without retiring pending edits and can retry", async () => {
    const engine = await opened();
    await engine.edit("model", [valueEdit(7), styleEdit]);
    const snapshot = stable(engine);
    const controller = new AbortController();
    api.get.mockImplementationOnce((_documentId, _jobId, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const saving = engine.serialize("model", { intentId: "save-1", snapshot, signal: controller.signal })
      .catch((error: unknown) => logCancellation(error, "journal"));
    const rejected = expect(saving).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    controller.abort();
    await rejected;
    expect(api.cancel).toHaveBeenCalledWith("doc", "job");
    await engine.edit("model", [valueEdit(8)]);
    await engine.serialize("model", { intentId: "save-1", snapshot });
    expect(editRequests()[1].edits).toEqual([valueEdit(7), styleEdit]);
    expect(engine.snapshot("model").sheets[0]?.cells.A1?.value).toBe(8);
  });
});

describe("native XLSX runtime through the real error dispatcher and save coordinator", () => {
  async function setup() {
    const engine = await opened();
    const outputs: { checksum_sha256: string; size_bytes: number }[] = [];
    const documents: XlsxDocumentsTransport = {
      read: vi.fn(), reconcile: vi.fn(async () => null),
      upload: vi.fn(async () => ({ upload_id: "upload", claim_expires_at: "2027-01-01T00:00:00Z", ...outputs.at(-1)! })),
      commit: vi.fn(async () => ({ document: { id: "doc", revision: "2" }, version: { id: "v2" } })),
    };
    const transport = createXlsxSaveTransport({ documents, documentId: "doc", runtime: engine,
      serialize: async (input) => {
        const result = await engine.serialize("model", input);
        outputs.push({ checksum_sha256: result.checksum, size_bytes: result.bytes.length });
        return result;
      } });
    const persisted = vi.fn(async () => undefined);
    const coordinator = createOfficeSaveCoordinator({ identity, transport, backoffMs: [0],
      editor: { getDirtyGeneration: () => stable(engine).generation, captureSnapshot: async () => stable(engine) } as EditorHandle<XlsxWorkbookSnapshot>,
      draft: { persistIntent: persisted, clearIntent: vi.fn(async () => undefined), discard: vi.fn(async () => undefined), checkpoint: vi.fn(), loadIntent: vi.fn(), recover: vi.fn() },
    });
    await engine.edit("model", [valueEdit(7)]);
    coordinator.markDirty(stable(engine).generation);
    return { engine, coordinator, documents, persisted };
  }
  const failed = (code: string, kind = "malformed_result") => ({ jobId: "job", state: "failed", error: { code, reason: "native failure", kind, retryable: true } }) as OfficeJob;

  it("preserves native code/kind/flag and supplies a validated engine class", async () => {
    const engine = await opened();
    api.get.mockResolvedValueOnce(failed("engine_result_invalid"));
    const error: unknown = await engine.serialize("model", { intentId: "save", snapshot: stable(engine) }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "engine_result_invalid", reason: "native failure", kind: "malformed_result", retryable: true, errorClass: "engine" });
    expect(dispatchOfficeError(error)).toMatchObject({ code: "engine_result_invalid", errorClass: "engine", action: "retry", retryable: true });
  });
  it("exhausts three automatic attempts then explicitly retries the same intent/prefix while N+1 stays live", async () => {
    const { engine, coordinator, documents, persisted } = await setup();
    api.get.mockImplementation(async () => {
      if (editRequests().length === 1) {
        await engine.edit("model", [valueEdit(8)]);
        coordinator.markDirty(stable(engine).generation);
      }
      return failed("engine_result_invalid");
    });
    expect(await coordinator.save("shortcut")).toEqual({ accepted: false, reason: "error" });
    expect(editRequests()).toHaveLength(3);
    expect(coordinator.getState().error).toMatchObject({ action: "retry", errorClass: "engine" });
    expect(documents.upload).not.toHaveBeenCalled();
    api.get.mockResolvedValue({ jobId: "job", state: "completed" } as OfficeJob);
    expect(await coordinator.retry()).toMatchObject({ accepted: true });
    expect(persisted).toHaveBeenCalledOnce();
    expect(editRequests().map((request) => request.edits)).toEqual(Array.from({ length: 4 }, () => [valueEdit(7)]));
    expect(engine.snapshot("model").sheets[0]!.cells.A1!.value).toBe(8);
    expect(coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 2, dirtyGeneration: 3 });
    expect(documents.commit).toHaveBeenCalledOnce();
  });
  it("routes the real polling deadline to reconcile and retains the same intent for retry", async () => {
    const { engine, coordinator, persisted } = await setup();
    const originalNow = Date.now;
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    api.get.mockImplementation(async () => { clock += 120_001; return { jobId: "job", state: "running" } as OfficeJob; });
    expect(await coordinator.save()).toEqual({ accepted: false, reason: "error" });
    expect(editRequests()).toHaveLength(3);
    expect(coordinator.getState().error).toMatchObject({ code: "engine_timeout", action: "reconcile", ambiguous: true });
    vi.spyOn(Date, "now").mockImplementation(originalNow);
    await engine.edit("model", [valueEdit(8)]);
    coordinator.markDirty(stable(engine).generation);
    api.get.mockResolvedValue({ jobId: "job", state: "completed" } as OfficeJob);
    expect(await coordinator.retry()).toMatchObject({ accepted: true });
    expect(persisted).toHaveBeenCalledOnce();
    expect(editRequests()[3].edits).toEqual([valueEdit(7)]);
  });
  it.each(["new_native_code", "network_error", "request_aborted"])("default denies native %s even with retryable=true", async code => {
    const { coordinator, documents } = await setup();
    api.get.mockResolvedValue(failed(code));
    await coordinator.save();
    expect(coordinator.getState().error).toMatchObject({ action: "stop", retryable: false, errorClass: "unknown" });
    expect(editRequests()).toHaveLength(1);
    expect(await coordinator.retry()).toEqual({ accepted: false, reason: "error" });
    expect(editRequests()).toHaveLength(1);
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it("polls at most 121 times in 120 seconds and does not relabel HTTP429 as engine timeout", async () => {
    const engine = await opened();
    vi.useFakeTimers();
    api.get.mockResolvedValue({ jobId: "job", state: "running" } as OfficeJob);
    const error = engine.serialize("model", { intentId: "bounded", snapshot: stable(engine) }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await error).toMatchObject({ code: "engine_timeout" });
    expect(api.get.mock.calls.length - 1).toBeLessThanOrEqual(121);
    vi.useRealTimers();
    const limited = Object.assign(new Error("rate limited"), { status: 429, code: "rate_limited" });
    api.get.mockRejectedValueOnce(limited);
    await expect(engine.serialize("model", { intentId: "bounded", snapshot: stable(engine) })).rejects.toBe(limited);
  });
  it("maps native cancellation to AbortError without retiring the candidate", async () => {
    const engine = await opened();
    api.get.mockResolvedValueOnce({ jobId: "job", state: "cancelled", error: { code: "engine_cancelled", retryable: false } } as OfficeJob);
    await expect(engine.serialize("model", { intentId: "cancel", snapshot: stable(engine) })
      .catch((error: unknown) => logCancellation(error, "native"))).rejects.toMatchObject({ name: "AbortError" });
    await engine.serialize("model", { intentId: "cancel", snapshot: stable(engine) });
    expect(editRequests()).toHaveLength(2);
  });
  it("preserves transport AbortError through coordinator cancel without automatic retries and later reuses the intent", async () => {
    const { engine, coordinator, documents, persisted } = await setup();
    api.get.mockImplementationOnce((_documentId, _jobId, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const saving = coordinator.save();
    await vi.waitFor(() => expect(editRequests()).toHaveLength(1));
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await coordinator.cancel();
    expect(await saving).toEqual({ accepted: false, reason: "error" });
    expect(coordinator.getState().error).toMatchObject({ code: "request_aborted", action: "reconcile", retryable: false });
    expect(editRequests()).toHaveLength(1);
    expect(documents.upload).not.toHaveBeenCalled();
    await engine.edit("model", [valueEdit(8)]);
    coordinator.markDirty(stable(engine).generation);
    expect(await coordinator.retry()).toMatchObject({ accepted: true });
    expect(persisted).toHaveBeenCalledOnce();
    expect(editRequests()[1].edits).toEqual([valueEdit(7)]);
  });
});
