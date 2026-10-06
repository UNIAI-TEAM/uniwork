// @vitest-environment jsdom
// UNI-940 X02 r3: the format adapter's cached snapshot (the draft checkpoint
// source) across a save commit, over the REAL web runtime. A draft taken right
// after a commit, before any further edit, must carry only the unsaved ops:
// a restore that replays already-saved edits writes them twice.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { initI18n } from "@uniwork/core/i18n";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createXlsxFormatAdapter, type XlsxDocumentsTransport } from "./xlsx-adapter";
import { createWebXlsxSessionRuntime } from "./xlsx-runtime";

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), download: vi.fn(), cancel: vi.fn() }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ startOfficeJob: api.start, getOfficeJob: api.get, downloadOfficeJobOutput: api.download, cancelOfficeJob: api.cancel }));

initI18n();

const identity: OfficeIdentity = { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "version-1", baseRevision: "1" };
const capability: OfficeCapabilityEntry = { format: "xlsx", operation: "edit", host: "web", engineBuild: "genoffice-test", contractRevision: "xlsx/1", status: "available", fidelityWarnings: [] };
const OUTPUT = new Uint8Array([80, 75, 3, 4]);
const OUTPUT_SHA = createHash("sha256").update(OUTPUT).digest("hex");
const workbook = (a1 = 2): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: a1 } } }] });
const renderModel = () => ({ revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] });
const cell = (address: string, value: number) => ({ op: "set_cell", target: { sheet: "Data", cell: address }, attributes: { value } });
const insert = (id: string) => ({ op: "set_visual", target: { sheet: "Data" }, attributes: { id, anchor: { fromRow: 1, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: 5, toColumn: 4, toRowOffset: 0, toColumnOffset: 0 }, shape: { shapeType: "rect" } } });

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
/** Documents whose commit is held until `release()`, so a test can type while it is in flight. */
function heldDocuments() {
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const commit = vi.fn(async () => {
    await gate;
    return { document: { id: "doc", revision: "2" }, version: { id: "version-2", checksum_sha256: OUTPUT_SHA, size_bytes: OUTPUT.byteLength } };
  });
  const files: XlsxDocumentsTransport = {
    read: vi.fn(async () => OUTPUT.slice()),
    upload: vi.fn(async () => ({ upload_id: "upload-1", checksum_sha256: OUTPUT_SHA, size_bytes: OUTPUT.byteLength, claim_expires_at: "2026-10-07T00:00:00Z" })),
    commit,
  };
  return { files, commit, release };
}
const editJobs = () => api.start.mock.calls.map((call) => call[1]).filter((body) => body.operation === "edit").map((body) => body.edits);

beforeEach(() => {
  vi.resetAllMocks();
  api.start.mockResolvedValue({ jobId: "job" });
  api.get.mockResolvedValue({ jobId: "job", state: "completed" });
  api.cancel.mockResolvedValue({});
  api.download.mockResolvedValue({ text: async () => JSON.stringify({ snapshot: workbook(), render_model: renderModel() }), arrayBuffer: async () => OUTPUT.slice().buffer });
});

describe("web XLSX adapter draft across a save commit", () => {
  it("checkpoints only the unsaved ops right after a commit, so a restore never replays the saved ones", async () => {
    const runtime = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "1" });
    const held = heldDocuments();
    const adapter = createXlsxFormatAdapter({ identity, session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime, documents: held.files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await adapter.editor.open();
    await adapter.editor.edit?.([cell("A1", 3), insert("v1")]);
    adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    const save = adapter.session.coordinator.save("button");
    await vi.waitFor(() => expect(held.commit).toHaveBeenCalledTimes(1));
    // Typed while the save is in flight: a cell and a chart/shape insert.
    await adapter.editor.edit?.([cell("B2", 8), insert("v2")]);
    adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    held.release();
    expect(await save).toMatchObject({ accepted: true });

    // No edit since the commit: the draft is the adapter's cached snapshot.
    const draft = await adapter.editor.captureSnapshot();
    expect((draft.value as { pendingOps?: unknown[] }).pendingOps).toEqual([cell("B2", 8), insert("v2")]);

    // Crash: a new tab opens the saved file (A1 = 3, the shape) and recovers the draft.
    api.download.mockResolvedValueOnce({ text: async () => JSON.stringify({ snapshot: workbook(3), render_model: renderModel() }) });
    const reopened = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "2" });
    const recovered = createXlsxFormatAdapter({ identity: { ...identity, baseRevision: "2", baseVersionId: "version-2" }, session: { sessionId: "session-2", deploymentId: "dep", accountId: "acct", generation: 1 }, runtime: reopened, documents: heldDocuments().files, capability, draftStore: draftStore(), keyProvider: keyProvider() });
    await recovered.onRecoverSnapshot?.(JSON.parse(JSON.stringify(draft)) as typeof draft);
    api.start.mockClear();
    const restored = reopened.snapshot("model");
    await reopened.serialize("model", { intentId: "save-2", snapshot: { generation: restored.revision, fingerprint: "f", value: restored } });
    expect(editJobs()).toEqual([[cell("B2", 8), insert("v2")]]);
    await adapter.session.dispose();
    await recovered.session.dispose();
  });
});
