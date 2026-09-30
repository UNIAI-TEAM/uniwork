// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeCapabilityEntry, OfficeIdentity, OfficeSerializedOutput, OfficeUploadReceipt } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createXlsxFormatAdapter, createXlsxSaveTransport, type XlsxDocumentsTransport, type XlsxSessionRuntime } from "./xlsx-adapter";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";

const identity: OfficeIdentity = {
  deploymentId: "dep",
  accountId: "acct",
  organizationId: "org",
  workspaceId: "ws",
  documentId: "doc",
  generation: 1,
  baseVersionId: "version-1",
  baseRevision: "1",
};
const capability: OfficeCapabilityEntry = {
  format: "xlsx",
  operation: "edit",
  host: "web",
  engineBuild: "genoffice-test",
  contractRevision: "xlsx/1",
  status: "available",
  fidelityWarnings: [],
};
const workbook = (): XlsxWorkbookSnapshot => ({
  revision: 1,
  sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 3 }, C1: { value: 5, formula: "=SUM(A1:B1)" } } }],
});

function draftStore(): IndexedDbDraftStore {
  return {
    checkpointEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    recoverEncrypted: vi.fn(async () => ({ status: "missing" as const })),
    deleteDurable: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    clearMemory: vi.fn(),
  } as unknown as IndexedDbDraftStore;
}
function keyProvider(): DraftKeyProvider {
  return {
    encrypt: vi.fn(async () => ({ ciphertext: new Uint8Array([1]), wrappedKey: new Uint8Array([2]), checksum: "sha256:1" })),
    decrypt: vi.fn(),
    recover: vi.fn(),
    clearMemory: vi.fn(async () => undefined),
    registerCleanup: vi.fn(() => () => undefined),
  };
}

function runtime(): XlsxSessionRuntime & { edits: unknown[][]; released: string[]; cancelled: string[] } {
  let current = workbook();
  const edits: unknown[][] = [];
  const released: string[] = [];
    const cancelled: string[] = [];
  return {
    edits,
    released,
    cancelled,
    open: vi.fn(async ({ documentId }) => ({ outcome: "opened" as const, document_id: documentId, document_model_ref: "model-1", snapshot: current })),
    edit: vi.fn(async (_ref, ops) => {
      edits.push([...ops]);
      const op = ops[0] as { target?: { sheet?: string; cell?: string }; text?: string; attributes?: { value?: XlsxCellState["value"]; formula?: string } };
      const text = op.attributes?.formula ?? (op.attributes?.value !== undefined ? String(op.attributes.value) : op.text);
      if (op.target?.sheet === "Data" && op.target.cell && typeof text === "string") {
        const cellAddress = op.target.cell;
        const nextCell: XlsxCellState = op.attributes?.formula !== undefined ? { value: null, formula: op.attributes.formula } : { value: op.attributes?.value ?? text };
        current = { ...current, sheets: current.sheets.map((sheet) => sheet.name === "Data" ? { ...sheet, cells: { ...sheet.cells, [cellAddress]: nextCell } } : sheet) };
      }
    }),
    snapshot: vi.fn(() => current),
    restore: vi.fn(async (_ref, snapshot) => { current = snapshot; }),
    serialize: vi.fn(async () => ({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output", warnings: [] })),
    recalculate: vi.fn(async (_ref, _signal, onProgress) => { onProgress?.(100); return { cells: [], cached: true }; }),
    cancelRecalculate: vi.fn(async (ref) => { cancelled.push(ref); }),
    release: vi.fn(async (ref) => { released.push(ref); }),
  };
}

function documents(): XlsxDocumentsTransport & { uploaded: Blob[]; commits: number } {
  const uploaded: Blob[] = [];
  let commits = 0;
  return {
    uploaded,
    get commits() { return commits; },
    read: vi.fn(async () => new Uint8Array([80, 75, 3, 4])),
    upload: vi.fn(async ({ file, idempotencyKey }) => {
      uploaded.push(file);
      expect(idempotencyKey).toMatch(/^office-key-/);
      return { upload_id: "upload-1", checksum_sha256: "sha256-output", size_bytes: 4, claim_expires_at: "2026-10-01T00:00:00Z" };
    }),
    commit: vi.fn(async ({ upload_id, base_revision }) => {
      commits += 1;
      expect(upload_id).toBe("upload-1");
      expect(base_revision).toBe("1");
      return { document: { id: "doc", revision: "2" }, version: { id: "version-2", checksum_sha256: "sha256-output", size_bytes: 4 } };
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("web XLSX format adapter", () => {
  it("opens through the runtime and saves exactly once through upload then commit", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const opened = await adapter.open.open();
    expect(opened).toMatchObject({ outcome: "opened", document_model_ref: "model-1" });
    await adapter.editor.recalculate?.run(new AbortController().signal);
    expect(adapter.editor.getDirtyGeneration()).toBe(2);
    await adapter.editor.recalculate?.cancel?.();
    expect(engine.cancelled).toEqual(["model-1"]);
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "7" }]);
    adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    const result = await adapter.session.coordinator.save("button");
    expect(result.accepted).toBe(true);
    expect(engine.serialize).toHaveBeenCalledTimes(1);
    expect(files.uploaded).toHaveLength(1);
    expect(files.commits).toBe(1);
    expect(adapter.session.coordinator.getState().identity.baseRevision).toBe("2");
    await adapter.session.dispose();
    expect(engine.released).toEqual(["model-1"]);
  });

  it("keeps the model and freshness honest when the native recalc rejects", async () => {
    const engine = runtime();
    engine.recalculate = vi.fn(async () => { throw new Error("engine_timeout"); });
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    await expect(adapter.editor.recalculate?.run(new AbortController().signal)).rejects.toThrow("engine_timeout");
    expect(adapter.editor.getWorkbookSnapshot?.()?.sheets[0]?.cells.C1).toMatchObject({ value: 5, formula: "=SUM(A1:B1)" });
    expect(files.uploaded).toHaveLength(0);
    await adapter.session.dispose();
  });

  it("applies a recovered protected snapshot through the runtime", async () => {
    const engine = runtime();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    const recovered: XlsxWorkbookSnapshot = {
      ...workbook(),
      sheets: workbook().sheets.map((sheet, index) => index === 0
        ? { ...sheet, cells: { ...sheet.cells, A1: { value: 99 } } }
        : sheet),
    };
    await adapter.onRecoverSnapshot?.({ generation: 4, fingerprint: "draft-fingerprint", value: recovered });
    expect(adapter.editor.getWorkbookSnapshot?.()?.sheets[0]?.cells.A1).toMatchObject({ value: 99 });
    expect(engine.restore).toHaveBeenCalledWith("model-1", recovered);
    await adapter.session.dispose();
  });

  it("rejects a server receipt that changes the serialized checksum", async () => {
    const files = documents();
    vi.spyOn(files, "upload").mockResolvedValueOnce({ upload_id: "upload-1", checksum_sha256: "other", size_bytes: 4, claim_expires_at: "2026-10-01T00:00:00Z" });
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc" });
    const intent = { intentId: "intent-1", idempotencyKey: "office-key-1", identity, snapshotGeneration: 2, snapshotFingerprint: "fp", snapshot: workbook(), operation: "manual_save" as const, createdAt: 1 };
    await expect(transport.upload({ intent, output: { data: new Uint8Array([1, 2, 3, 4]), checksumSha256: "sha256-output", sizeBytes: 4, format: "xlsx" } })).rejects.toThrow("upload_checksum_mismatch");
    expect(files.commit).not.toHaveBeenCalled();
  });

  it("preserves the native failure class and engine detail on open", async () => {
    const engine = runtime();
    engine.open = vi.fn(async ({ documentId }) => ({
      outcome: "failed" as const,
      document_id: documentId,
      failure_class: "unsupported_feature",
      engine_error: "sidecar_formula_error",
      message: "native engine rejected workbook",
    }));
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await expect(adapter.open.open()).resolves.toMatchObject({ outcome: "failed", failure_class: "unsupported_feature", engine_error: "sidecar_formula_error" });
    await adapter.session.dispose();
  });

  it("releases a runtime model that finishes opening after dispose", async () => {
    const engine = runtime();
    type OpenResult = Awaited<ReturnType<XlsxSessionRuntime["open"]>>;
    let finishOpen!: (value: OpenResult) => void;
    engine.open = vi.fn(async () => new Promise<OpenResult>((resolve) => { finishOpen = resolve; }));
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const opening = adapter.open.open();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(engine.open).toHaveBeenCalledTimes(1);
    await adapter.session.dispose();
    finishOpen({ outcome: "opened", document_id: "doc", document_model_ref: "late-model", snapshot: workbook() });
    await expect(opening).resolves.toMatchObject({ outcome: "failed", message: "xlsx_editor_disposed" });
    expect(engine.released).toEqual(["late-model"]);
  });

  it("rejects a malformed commit receipt before reporting success", async () => {
    const files = documents();
    const intent = { intentId: "intent-1", idempotencyKey: "office-key-1", identity, snapshotGeneration: 2, snapshotFingerprint: "fp", snapshot: workbook(), operation: "manual_save" as const, createdAt: 1 };
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", serialize: async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), checksum: "sha256-output" }) });
    const output = await transport.serialize({ intent, snapshot: { generation: 2, fingerprint: "fp", value: workbook() } }) as OfficeSerializedOutput;
    const upload = await transport.upload({ intent, output }) as OfficeUploadReceipt;
    vi.spyOn(files, "commit").mockResolvedValueOnce({ document: { id: "doc", revision: "2" }, version: { id: "", checksum_sha256: "sha256-output", size_bytes: 4 } });
    await expect(transport.commit({ intent, upload })).rejects.toThrow("malformed_commit_receipt");
  });
});
