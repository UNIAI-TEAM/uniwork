// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, isValidElement, StrictMode, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OfficeEditorHost } from "./editor-host";
import type { OfficeCapabilityEntry, OfficeIdentity, OfficeSerializedOutput, OfficeUploadReceipt } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createXlsxFormatAdapter, createXlsxSaveTransport, type XlsxDocumentsTransport, type XlsxSessionRuntime } from "./xlsx-adapter";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { initI18n, setLocale } from "@uniwork/core/i18n";

initI18n();

// jsdom ships neither matchMedia nor the observers the vendored XlsxEditor
// tree mounts (the office ribbon reads a media query; the grid surface uses
// ResizeObserver). The StrictMode tests render that real tree, so install the
// minimal stubs once. Every query answers false and every observer is inert.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= TestResizeObserver;
class TestIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= TestIntersectionObserver;

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
    rebaseEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
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

beforeEach(async () => { await setLocale("en"); });
afterEach(() => vi.restoreAllMocks());

describe("web XLSX format adapter", () => {
  it("prepares the pending view edit before header Save and refuses a second Save during preparation", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    if (!isValidElement<{ registerSavePreparation?: (prepare: () => Promise<void>) => () => void }>(adapter.editorView) || !adapter.editorView.props.registerSavePreparation) throw new Error("View Save preparation is unbound");
    const unregister = adapter.editorView.props.registerSavePreparation(async () => {
      await pending;
      await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }]);
      adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    });
    const save = adapter.session.coordinator.save("button");
    expect(await adapter.session.coordinator.save("shortcut")).toEqual({ accepted: false, reason: "saving" });
    expect(engine.serialize).not.toHaveBeenCalled();
    finish();
    expect((await save).accepted).toBe(true);
    expect(vi.mocked(engine.serialize).mock.calls[0]?.[1].snapshot.value.sheets[0]?.cells.A1?.value).toBe(7);
    expect(files.commits).toBe(1);
    unregister();
    await adapter.session.dispose();
  });
  it("shares one in-flight native open when React replays the view effect", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const results = await Promise.all([adapter.open.open(), adapter.open.open()]);
    expect(results.map(result => result.outcome)).toEqual(["opened", "opened"]);
    expect(engine.open).toHaveBeenCalledTimes(1);
    expect(files.read).toHaveBeenCalledTimes(1);
    await adapter.session.dispose();
    expect(engine.released).toEqual(["model-1"]);
  });
  it("never serializes an edit preparation rejected by the grid and permits a later retry", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }]);
    adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    if (!isValidElement<{ registerSavePreparation?: (prepare: () => Promise<void>) => () => void }>(adapter.editorView) || !adapter.editorView.props.registerSavePreparation) throw new Error("View Save preparation is unbound");
    const unregister = adapter.editorView.props.registerSavePreparation(async () => { throw new Error("uncommitted edit"); });
    expect(await adapter.session.coordinator.save("button")).toEqual({ accepted: false, reason: "error" });
    expect(engine.serialize).not.toHaveBeenCalled();
    expect(adapter.editor.getWorkbookSnapshot?.()?.sheets[0]?.cells.A1?.value).toBe(7);
    unregister();
    expect((await adapter.session.coordinator.retry!()).accepted).toBe(true);
    expect(files.commits).toBe(1);
    await adapter.session.dispose();
  });
  it("refuses a prepared Save after its editing session is disposed", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    if (!isValidElement<{ registerSavePreparation?: (prepare: () => Promise<void>) => () => void }>(adapter.editorView) || !adapter.editorView.props.registerSavePreparation) throw new Error("View Save preparation is unbound");
    adapter.editorView.props.registerSavePreparation(() => pending);
    const save = adapter.session.coordinator.save("button");
    await adapter.session.dispose();
    finish();
    expect(await save).toEqual({ accepted: false, reason: "stale" });
    expect(engine.serialize).not.toHaveBeenCalled();
    expect(files.commits).toBe(0);
  });
  it("opens through the runtime and saves exactly once through upload then commit", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const opened = await adapter.open.open();
    expect(opened).toMatchObject({ outcome: "opened", document_model_ref: "model-1" });
    expect(adapter.editor.getDirtyGeneration()).toBe(0);
    await adapter.editor.recalculate?.run(new AbortController().signal);
    expect(adapter.editor.getDirtyGeneration()).toBe(1);
    await adapter.editor.recalculate?.cancel?.();
    expect(engine.cancelled).toEqual(["model-1"]);
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "7" }]);
    expect(adapter.editor.getDirtyGeneration()).toBe(2);
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

  it("maps a thrown upload_bounds open error to too_large instead of engine_error (UNI-956)", async () => {
    const engine = runtime();
    engine.open = vi.fn(async () => { throw Object.assign(new Error("workbook too large"), { code: "upload_bounds", kind: "byte_bound" }); });
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await expect(adapter.open.open()).resolves.toMatchObject({ outcome: "failed", failure_class: "too_large" });
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

  it("captures generation and content together while hashing yields to another edit", async () => {
    const engine = runtime();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.editor.open();
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }]);
    let finishHash!: (digest: ArrayBuffer) => void;
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { finishHash = resolve; }));
    const capture = adapter.editor.captureSnapshot();
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 8 } }]);
    finishHash(new Uint8Array([1]).buffer);
    expect(await capture).toMatchObject({ generation: 1, value: { sheets: [{ cells: { A1: { value: 7 } } }] } });
    expect(adapter.editor.getDirtyGeneration()).toBe(2);
    await adapter.session.dispose();
  });

  it("passes Save N's stable snapshot to serialize and leaves typing N+1 dirty", async () => {
    const engine = runtime();
    const files = documents();
    let finishSerialize!: (out: { bytes: Uint8Array; checksum: string }) => void;
    engine.serialize = vi.fn(() => new Promise<{ bytes: Uint8Array; checksum: string }>((resolve) => { finishSerialize = resolve; }));
    engine.setBaseRevision = vi.fn();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.editor.open();
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }]);
    adapter.session.coordinator.markDirty(1);
    const save = adapter.session.coordinator.save("button");
    await vi.waitFor(() => expect(engine.serialize).toHaveBeenCalledTimes(1));
    await adapter.editor.edit?.([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 8 } }]);
    adapter.session.coordinator.markDirty(2);
    finishSerialize({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output" });
    const result = await save;
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(`save_failed:${result.reason}`);
    expect(engine.serialize).toHaveBeenCalledWith("model-1", expect.objectContaining({ intentId: result.intentId, snapshot: expect.objectContaining({ generation: 1, value: expect.objectContaining({ sheets: [expect.objectContaining({ cells: expect.objectContaining({ A1: { value: 7 } }) })] }) }) }));
    expect(engine.setBaseRevision).toHaveBeenCalledWith("2", result.intentId);
    expect(adapter.session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 1, dirtyGeneration: 2 });
    expect(await adapter.editor.captureSnapshot()).not.toHaveProperty("checksumSha256");
    await adapter.session.dispose();
  });

  it("forwards cancellation through the existing save transport without uploading", async () => {
    const files = documents();
    const snapshot = { generation: 1, fingerprint: "fp", value: workbook() };
    const intent = { intentId: "intent-cancel", idempotencyKey: "office-key-cancel", identity, snapshotGeneration: 1, snapshotFingerprint: "fp", snapshot: snapshot.value, operation: "manual_save" as const, createdAt: 1 };
    let signal!: AbortSignal;
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", serialize: (input) => {
      signal = input.signal!;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
    } });
    const saving = transport.serialize({ intent, snapshot });
    const rejected = expect(saving).rejects.toMatchObject({ name: "AbortError" });
    await transport.cancel?.({ intent });
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(files.upload).not.toHaveBeenCalled();
  });

  it.each([{ revision: "1" }, { revision: "invalid" }, { engine_name: "" }, { checksum_sha256: "different" }])("keeps pending operations until the entire commit receipt is valid: %j", async (patch) => {
    const engine = runtime();
    engine.setBaseRevision = vi.fn();
    const files = documents();
    const snapshot = { generation: 1, fingerprint: "fp", value: workbook() };
    const intent = { intentId: "intent-validate", idempotencyKey: "office-key-validate", identity, snapshotGeneration: 1, snapshotFingerprint: "fp", snapshot: snapshot.value, operation: "manual_save" as const, createdAt: 1 };
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", runtime: engine, serialize: () => engine.serialize("model", { intentId: intent.intentId, snapshot }) });
    const output = await transport.serialize({ intent, snapshot }) as OfficeSerializedOutput;
    const upload = await transport.upload({ intent, output }) as OfficeUploadReceipt;
    vi.mocked(files.commit).mockResolvedValueOnce({ document: { id: "doc", revision: "2", ...("revision" in patch ? patch : {}) }, version: { id: "v2", checksum_sha256: "sha256-output", size_bytes: 4, ...patch } });
    await expect(transport.commit({ intent, upload })).rejects.toThrow();
    expect(engine.setBaseRevision).not.toHaveBeenCalled();
    await transport.serialize({ intent, snapshot });
    await transport.commit({ intent, upload });
    expect(engine.serialize).toHaveBeenCalledTimes(1);
    expect(engine.setBaseRevision).toHaveBeenCalledWith("2", intent.intentId);
  });

  // UNI-926 R3-STRICTMODE: `next dev` mounts every tree twice (mount ->
  // cleanup -> mount). The shared OfficeEditorHost disposes
  // formatAdapter.session in its [] unmount cleanup, and xlsx-office-host
  // mounts OfficeEditorHost only once the adapter exists (pending gate), so
  // the simulated unmount used to kill a LIVE session and the replayed mount
  // then opened a dead editor ("xlsx_editor_disposed").
  async function mountStrict(adapter: ReturnType<typeof createXlsxFormatAdapter>) {
    const container = document.createElement("div");
    document.body.append(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // T10: the shared host is the only StrictMode mechanism (its dispose is
    // deferred past the replayed mount); the adapter disposes when asked.
    const officeDocument = {
      id: identity.documentId, workspace_id: identity.workspaceId, organization_id: identity.organizationId, kind: "file", title: "Office document", revision: "1", current_version: 1,
      file: { file_id: "file", version_id: "version-1", version: 1, filename: "document.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 3, checksum_sha256: "sha256:file" },
    } as never;
    let root!: Root;
    await act(async () => { root = createRoot(container); root.render(createElement(StrictMode, null, createElement(OfficeEditorHost, { document: officeDocument, wsId: identity.workspaceId, readonly: false, formatAdapter: adapter as never }))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    return { container, root };
  }

  it("survives a StrictMode double mount: the workbook renders and the model is not released", async () => {
    const engine = runtime();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const { container, root } = await mountStrict(adapter);
    expect(container.querySelector('[data-testid="xlsx-error-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="xlsx-workbook-surface"]')).not.toBeNull();
    expect(engine.released).toEqual([]);

    // A real unmount still releases the model.
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(engine.released).toEqual(["model-1"]);
    container.remove();
  });

  it("retries a failed open on the same adapter under StrictMode", async () => {
    const engine = runtime();
    const open = vi.mocked(engine.open);
    const succeed = open.getMockImplementation()!;
    open.mockImplementationOnce(() => Promise.reject(new Error("transient")));
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    const { container, root } = await mountStrict(adapter);
    const retry = container.querySelector('[data-testid="xlsx-error-state"] button') as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    expect(container.querySelector('[data-testid="xlsx-error-state"]')?.textContent).not.toContain("xlsx_editor_disposed");
    open.mockImplementation(succeed);
    await act(async () => { retry!.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.querySelector('[data-testid="xlsx-workbook-surface"]')).not.toBeNull();
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    container.remove();
  });

  it("makes session dispose idempotent and releases the model once", async () => {
    const engine = runtime();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: engine, documents: documents(), capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.open.open();
    const first = adapter.session.dispose();
    expect(adapter.session.dispose()).toBe(first);
    await first;
    await adapter.session.dispose();
    expect(engine.released).toEqual(["model-1"]);
  });
});

describe("web XLSX save transport: the commit's rebase is a marked rebase window (T09 r2)", () => {
  const intent = { intentId: "intent-r2", idempotencyKey: "office-key-r2", identity, snapshotGeneration: 2, snapshotFingerprint: "fp", snapshot: workbook(), operation: "manual_save" as const, createdAt: 1 };
  const receipt = { intentId: "intent-r2", idempotencyKey: "office-key-r2", documentId: "doc", versionId: "version-2", revision: "2", checksumSha256: "sha256-output", sizeBytes: 4, engineName: "genoffice", engineVersion: "1", contractVersion: "1", protocolVersion: "1" };

  it("marks the rebase before the runtime moves its base, on commit and on a found reconcile", async () => {
    const engine = runtime();
    engine.setBaseRevision = vi.fn();
    const markRebase = vi.fn();
    const files = { ...documents(), reconcile: vi.fn(async () => receipt) };
    const transport = createXlsxSaveTransport({ documents: files, documentId: "doc", runtime: engine, markRebase, serialize: async () => ({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output" }) });
    const output = await transport.serialize({ intent, snapshot: { generation: 2, fingerprint: "fp", value: workbook() } }) as OfficeSerializedOutput;
    const upload = await transport.upload({ intent, output }) as OfficeUploadReceipt;
    await transport.commit({ intent, upload });
    expect(markRebase).toHaveBeenCalledTimes(1);
    expect(markRebase.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(engine.setBaseRevision).mock.invocationCallOrder[0]!);
    await expect(transport.reconcile({ intent })).resolves.toMatchObject({ revision: "2" });
    expect(markRebase).toHaveBeenCalledTimes(2);
    expect(markRebase.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(engine.setBaseRevision).mock.invocationCallOrder[1]!);
  });
});
