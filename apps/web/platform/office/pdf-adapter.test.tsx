// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createPdfFormatAdapter, type PdfFormatAdapterOptions } from "./pdf-adapter";
import type { PdfRenderSession } from "./pdf-render";
import type { PdfDocumentsTransport } from "./pdf-save-transport";

const identity: OfficeIdentity = {
  deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc",
  generation: 1, baseVersionId: "version-1", baseRevision: "1",
};
const capability: OfficeCapabilityEntry = {
  format: "pdf", operation: "serialize", host: "web", engineBuild: "test", contractRevision: "pdf/1", status: "available", fidelityWarnings: [],
};
const original = new Uint8Array([37, 80, 68, 70, 1]);

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
    decrypt: vi.fn(), recover: vi.fn(), clearMemory: vi.fn(async () => undefined), registerCleanup: vi.fn(() => () => undefined),
  };
}

interface FakeSession extends PdfRenderSession {
  bytesSeen: Uint8Array[];
  disposed: boolean;
}
function fakeSession(bytes: Uint8Array, pageTexts: string[]): FakeSession {
  let texts = pageTexts;
  const session: FakeSession = {
    bytesSeen: [bytes],
    disposed: false,
    pages: () => texts.map((_, index) => ({ pageNumber: index + 1, width: 612, height: 792 })),
    pageText: (page) => texts[page - 1] ?? "",
    renderPage: vi.fn(async (request) => ({ src: `blob:page-${request.pageNumber}`, width: 612, height: 792 })),
    replaceBytes: vi.fn(async (next: Uint8Array) => { session.bytesSeen.push(next); if (next.length > 6) texts = [...texts, "extra"]; }),
    dispose: () => { session.disposed = true; },
  };
  return session;
}

function setup(overrides: Partial<PdfFormatAdapterOptions> = {}) {
  const sessions: FakeSession[] = [];
  const documents: PdfDocumentsTransport = {
    read: vi.fn(async () => original),
    upload: vi.fn(async () => null),
    commit: vi.fn(async () => null),
  };
  const createRenderSession = vi.fn(async (bytes: Uint8Array) => {
    const session = fakeSession(bytes, ["Hello World", "second hello page"]);
    sessions.push(session);
    return session;
  });
  const applyOps = vi.fn(async (_bytes: Uint8Array, ops: readonly unknown[]) => ({
    bytes: new Uint8Array([37, 80, 68, 70, 1, 2, 3, ops.length]),
    skipped: [{ op: "x", reason: "noop" }],
  }));
  const readFormFields = vi.fn(async () => [{ name: "f", kind: "text" as const, value: "v" }]);
  const adapter = createPdfFormatAdapter({
    identity, session: { sessionId: "s", deploymentId: "dep", accountId: "acct", generation: 1 }, documents, capability, title: "Doc",
    draftStore: draftStore(), keyProvider: keyProvider(), createRenderSession, applyOps, readFormFields, ...overrides,
  });
  return { adapter, editor: adapter.editor, documents, sessions, createRenderSession, applyOps, readFormFields };
}

describe("web PDF format adapter", () => {
  it("opens through the render session and exposes pages from pdfium", async () => {
    const { adapter, editor, documents, createRenderSession } = setup();
    const outcome = await adapter.open.open();
    expect(outcome).toMatchObject({ outcome: "opened", document_id: "doc" });
    expect(documents.read).toHaveBeenCalledTimes(1);
    expect(createRenderSession).toHaveBeenCalledWith(original);
    expect(editor.getPdfSnapshot?.()).toEqual({ pages: [{ pageNumber: 1, rotation: 0 }, { pageNumber: 2, rotation: 0 }], pageCount: 2 });
    expect(editor.getCanvasPages?.()).toEqual([{ pageNumber: 1, width: 612, height: 792 }, { pageNumber: 2, width: 612, height: 792 }]);
    expect(await editor.renderer?.renderPage({ pageNumber: 1, width: 612, height: 792, scale: 1 })).toMatchObject({ src: "blob:page-1" });
    await adapter.session.dispose();
  });

  it("applies engine operations to the current bytes, swaps the render document and notifies subscribers", async () => {
    const { adapter, editor, applyOps, sessions } = setup();
    await adapter.open.open();
    const listener = vi.fn();
    editor.subscribe?.(listener);
    const before = await editor.captureSnapshot();
    const result = await editor.submitEngineOperations?.([{ op: "addNote" }]);
    expect(result).toEqual({ skipped: [{ op: "x", reason: "noop" }] });
    expect(applyOps).toHaveBeenCalledWith(original, [{ op: "addNote" }]);
    expect(sessions[0]!.replaceBytes).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.getDirtyGeneration()).toBe(1);
    const after = await editor.captureSnapshot();
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.value.pageCount).toBe(3);
    const serialized = await editor.serializeSnapshot(after);
    expect(Array.from(serialized.bytes)).toEqual([37, 80, 68, 70, 1, 2, 3, 1]);
    await adapter.session.dispose();
  });

  it("bridges view operations into engine envelopes", async () => {
    const { adapter, editor, applyOps } = setup();
    await adapter.open.open();
    await editor.edit?.([{ op: "add_markup", target: { page: 1, quads: [[0, 10, 5, 10, 0, 0, 5, 0]] }, type: "highlight", color: [1, 1, 0] }]);
    const ops = applyOps.mock.calls[0]![1] as { op: string }[];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "addMarkup" });
    await adapter.session.dispose();
  });

  it("keeps state untouched and rethrows when the engine refuses an operation", async () => {
    const applyOps = vi.fn(async () => { throw new Error("unsupported_in_browser"); });
    const { adapter, editor } = setup({ applyOps });
    await adapter.open.open();
    await expect(editor.submitEngineOperations?.([{ op: "putTextEdit" }])).rejects.toThrow("unsupported_in_browser");
    expect(editor.getDirtyGeneration()).toBe(0);
    expect(Array.from((await editor.serializeSnapshot(await editor.captureSnapshot())).bytes)).toEqual(Array.from(original));
    await adapter.session.dispose();
  });

  it("undoes and redoes by swapping byte stacks", async () => {
    const { adapter, editor, sessions } = setup();
    await adapter.open.open();
    await editor.submitEngineOperations?.([{ op: "a" }]);
    const edited = (await editor.serializeSnapshot(await editor.captureSnapshot())).bytes;
    const changed = new Promise<void>((resolve) => { const off = editor.subscribe!(() => { off(); resolve(); }); });
    editor.undo?.();
    await changed;
    expect(Array.from((await editor.serializeSnapshot(await editor.captureSnapshot())).bytes)).toEqual(Array.from(original));
    expect(editor.getDirtyGeneration()).toBe(2);
    const redone = new Promise<void>((resolve) => { const off = editor.subscribe!(() => { off(); resolve(); }); });
    editor.redo?.();
    await redone;
    expect(Array.from((await editor.serializeSnapshot(await editor.captureSnapshot())).bytes)).toEqual(Array.from(edited));
    expect(sessions[0]!.replaceBytes).toHaveBeenCalledTimes(3);
    await adapter.session.dispose();
  });

  it("reads form fields from the current bytes and searches page text case-insensitively", async () => {
    const { adapter, editor, readFormFields } = setup();
    await adapter.open.open();
    expect(await editor.readFormFields?.()).toEqual([{ name: "f", kind: "text", value: "v" }]);
    expect(readFormFields).toHaveBeenCalledWith(original);
    const hits = await editor.searchText?.("HELLO");
    expect(hits?.map((hit) => [hit.page, hit.start, hit.text])).toEqual([[1, 0, "Hello"], [2, 7, "hello"]]);
    expect(await editor.searchText?.("   ")).toEqual([]);
    await adapter.session.dispose();
  });

  it("survives a StrictMode dispose then open: re-opens from cached bytes with a fresh session", async () => {
    const { adapter, editor, documents, sessions, createRenderSession } = setup();
    await adapter.open.open();
    await editor.dispose();
    expect(sessions[0]!.disposed).toBe(true);
    expect(editor.getPdfSnapshot?.()).toBeNull();
    const outcome = await adapter.open.open();
    expect(outcome.outcome).toBe("opened");
    expect(createRenderSession).toHaveBeenCalledTimes(2);
    expect(documents.read).toHaveBeenCalledTimes(1);
    expect(sessions[1]!.disposed).toBe(false);
    expect(editor.getCanvasPages?.()).toHaveLength(2);
    await adapter.session.dispose();
  });

  it("disposes a session that finishes opening after dispose()", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const late: FakeSession[] = [];
    const createRenderSession = vi.fn(async (bytes: Uint8Array) => { await gate; const s = fakeSession(bytes, ["a"]); late.push(s); return s; });
    const { adapter, editor } = setup({ createRenderSession });
    const first = editor.open();
    await Promise.resolve();
    void editor.dispose();
    release();
    await expect(first).rejects.toThrow("pdf_editor_disposed");
    expect(late[0]!.disposed).toBe(true);
    await adapter.session.dispose();
  });

  it("makes host session disposal terminal", async () => {
    const { adapter, editor, sessions } = setup();
    await adapter.open.open();
    await adapter.session.dispose();
    expect(sessions[0]!.disposed).toBe(true);
    await expect(editor.open()).rejects.toThrow("pdf_editor_disposed");
  });

  it("reports a typed failure class when the render session cannot open", async () => {
    const createRenderSession = vi.fn(async () => { throw Object.assign(new Error("password needed"), { code: "password_required" }); });
    const { adapter } = setup({ createRenderSession });
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", format: "pdf", failure_class: "password_required", message: "password needed" });
    await adapter.session.dispose();
  });

  it("maps an unknown open error to engine_error", async () => {
    const { adapter } = setup({ documents: { read: vi.fn(async () => { throw new Error("network"); }), upload: vi.fn(), commit: vi.fn() } });
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", failure_class: "engine_error", message: "network" });
    await adapter.session.dispose();
  });
});
