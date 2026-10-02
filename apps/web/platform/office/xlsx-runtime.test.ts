import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officeSerializedOutputSchema, officeUploadReceiptSchema, type OfficeIdentity, type OfficeSaveIntent, type StableSnapshot } from "@uniwork/core/office";
import type { OfficeJob } from "@uniwork/core/api/endpoints/office";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { createWebXlsxSessionRuntime } from "./xlsx-runtime";
import { createXlsxSaveTransport, type XlsxDocumentsTransport, type XlsxSessionRuntime } from "./xlsx-adapter";

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), download: vi.fn(), cancel: vi.fn() }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ startOfficeJob: api.start, getOfficeJob: api.get, downloadOfficeJobOutput: api.download, cancelOfficeJob: api.cancel }));

const workbook = (): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 4, formula: "=A1*2", rawValue: 4 } } }] });
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

beforeEach(() => {
  vi.resetAllMocks();
  api.start.mockResolvedValue({ jobId: "job" });
  api.get.mockResolvedValue({ jobId: "job", state: "completed" } as OfficeJob);
  api.cancel.mockResolvedValue({});
  api.download.mockResolvedValue({ text: async () => JSON.stringify({ snapshot: workbook() }), arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer });
});
afterEach(() => vi.restoreAllMocks());

describe("web XLSX save journal", () => {
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
    await expect(engine.serialize("model", { intentId: "save-1", snapshot })).rejects.toThrow("office_job_timeout");
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
    const saving = engine.serialize("model", { intentId: "save-1", snapshot, signal: controller.signal });
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
