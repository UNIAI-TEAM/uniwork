// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, type Mock } from "vitest";
import { PdfEditor } from "@uniwork/views/office/pdf";
import { applyPdfOpsInBrowser } from "@uniwork/office-engine/browser";
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

/** Minimal one-page PDF (empty page tree). Hand-written so the note round-trip
    drives the real browser writer/reader without apps/web depending on pdf-lib. */
const BASE_PDF_TEXT =
  "%PDF-1.4\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> >>\nendobj\n" +
  "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n";
// Uint8Array.from, not TextEncoder: pdf-lib's instanceof check rejects a
// jsdom-realm view over the same buffer.
const BASE_PDF = Uint8Array.from(BASE_PDF_TEXT, (char) => char.charCodeAt(0));
const NOTE_RECT: [number, number, number, number] = [40, 200, 60, 220];

/** A fresh adapter over BASE_PDF whose engine ops run for real. */
function noteSetup() {
  return setup({
    applyOps: applyPdfOpsInBrowser,
    documents: { read: vi.fn(async () => BASE_PDF), upload: vi.fn(async () => null), commit: vi.fn(async () => null) },
  });
}

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
  replaceBytes: Mock<PdfRenderSession["replaceBytes"]>;
}
function fakeSession(bytes: Uint8Array, pageTexts: string[]): FakeSession {
  let texts = pageTexts;
  const session: FakeSession = {
    bytesSeen: [bytes],
    disposed: false,
    pages: () => texts.map((_, index) => ({ pageNumber: index + 1, width: 612, height: 792 })),
    pageText: (page) => texts[page - 1] ?? "",
    pageCharBoxes: (page) => (texts[page - 1] ?? "").split("").map((_c, index) => ({ x: index, y: 0, width: 1, height: 1 })),
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
    expect(createRenderSession).toHaveBeenCalledWith(original, undefined);
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

  it("reports canUndo/canRedo from the stacks, already moved when subscribers run (UNI-954)", async () => {
    const { adapter, editor } = setup();
    await adapter.open.open();
    expect(editor.canUndo?.()).toBe(false);
    expect(editor.canRedo?.()).toBe(false);
    const seen: Array<[boolean | undefined, boolean | undefined]> = [];
    editor.subscribe?.(() => seen.push([editor.canUndo?.(), editor.canRedo?.()]));
    await editor.submitEngineOperations?.([{ op: "a" }]);
    const stepped = () => new Promise<void>((resolve) => { const off = editor.subscribe!(() => { off(); resolve(); }); });
    let next = stepped();
    editor.undo?.();
    await next;
    next = stepped();
    editor.redo?.();
    await next;
    expect(seen).toEqual([[true, false], [false, true], [true, false]]);
    // A redo on the now-empty redo stack is a no-op: no notify, no generation bump.
    const generation = editor.getDirtyGeneration();
    editor.redo?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(3);
    expect(editor.getDirtyGeneration()).toBe(generation);
    await adapter.session.dispose();
  });

  it("rejects an edit overtaken by dispose, committing nothing: pdf_editor_disposed mid-swap, not-open before it (review-fe-r1 R17)", async () => {
    // Disposed while the render session swaps the edited bytes.
    const swapping = setup();
    await swapping.adapter.open.open();
    let releaseSwap: (() => void) | null = null;
    swapping.sessions[0]!.replaceBytes.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSwap = resolve; }));
    const listener = vi.fn();
    swapping.editor.subscribe?.(listener);
    const edit = swapping.editor.submitEngineOperations!([{ op: "a" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseSwap).not.toBeNull();
    void swapping.editor.dispose();
    releaseSwap!();
    await expect(edit).rejects.toThrow("pdf_editor_disposed");
    expect(listener).not.toHaveBeenCalled();
    expect(swapping.editor.getDirtyGeneration()).toBe(0);
    expect(swapping.editor.canUndo?.()).toBe(false);
    await swapping.adapter.session.dispose();

    // Disposed while the engine still computes: the swap never starts.
    let releaseOps: (() => void) | null = null;
    const applyOps = vi.fn(async () => { await new Promise<void>((resolve) => { releaseOps = resolve; }); return { bytes: new Uint8Array([37, 80, 68, 70, 1, 9]), skipped: [] }; });
    const computing = setup({ applyOps });
    await computing.adapter.open.open();
    const late = computing.editor.submitEngineOperations!([{ op: "a" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    void computing.editor.dispose();
    releaseOps!();
    await expect(late).rejects.toThrow("pdf_editor_not_open");
    expect(computing.sessions[0]!.replaceBytes).not.toHaveBeenCalled();
    expect(computing.editor.getDirtyGeneration()).toBe(0);
    await computing.adapter.session.dispose();
  });

  it("a step overtaken by dispose commits nothing (r5 F4 parity)", async () => {
    const { adapter, editor, sessions } = setup();
    await adapter.open.open();
    await editor.submitEngineOperations?.([{ op: "a" }]);
    let release: (() => void) | null = null;
    sessions[0]!.replaceBytes.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const listener = vi.fn();
    editor.subscribe?.(listener);
    editor.undo?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(release).not.toBeNull();
    void editor.dispose();
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
    expect(editor.getDirtyGeneration()).toBe(0);
    expect(editor.canUndo?.()).toBe(false);
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

  it("attaches per-line quads to each hit from the page's char boxes", async () => {
    const { adapter, editor } = setup();
    await adapter.open.open();
    const hits = await editor.searchText?.("HELLO");
    // Page text is "Hello World": the hit covers chars 0-4 -> one quad in
    // bottom-left space (page height 792; box top-left y=0, height=1).
    expect(hits?.[0]?.quads).toEqual([[0, 791, 5, 792]]);
    await adapter.session.dispose();
  });

  it("flips display-space char boxes with the display height on a rotated page", async () => {
    // A /Rotate 90 page reports a swapped display size (200x100). pageCharBoxes
    // already carry the /Rotate transform, so the quad flip uses the display
    // height (100) the renderer reports.
    const session: PdfRenderSession = {
      pages: () => [{ pageNumber: 1, width: 200, height: 100, rotation: 90 }],
      pageText: () => "Hello",
      pageCharBoxes: () => "Hello".split("").map((_c, index) => ({ x: index * 10, y: 50, width: 10, height: 8 })),
      renderPage: vi.fn(async (request) => ({ src: `blob:page-${request.pageNumber}`, width: 200, height: 100 })),
      replaceBytes: vi.fn(async () => undefined),
      dispose: () => undefined,
    };
    const { adapter, editor } = setup({ createRenderSession: vi.fn(async () => session) });
    await adapter.open.open();
    const hits = await editor.searchText?.("HELLO");
    // Display height 100: y1 = 100 - (50 + 8) = 42, y2 = 100 - 50 = 50.
    expect(hits?.[0]?.quads).toEqual([[0, 42, 50, 50]]);
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

  it("maps a too-large source to the too_large failure class (UNI-956)", async () => {
    const { adapter } = setup({ documents: { read: vi.fn(async () => { throw Object.assign(new Error("too big"), { code: "file_too_large" }); }), upload: vi.fn(), commit: vi.fn() } });
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", format: "pdf", failure_class: "too_large" });
    await adapter.session.dispose();
  });

  it("maps an unknown open error to engine_error", async () => {
    const { adapter } = setup({ documents: { read: vi.fn(async () => { throw new Error("network"); }), upload: vi.fn(), commit: vi.fn() } });
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", failure_class: "engine_error", message: "network" });
    await adapter.session.dispose();
  });

  it("threads the password through open so a protected file opens, and a retry re-runs with the new password", async () => {
    const password = "s3cret";
    const openedSessions: FakeSession[] = [];
    const createRenderSession = vi.fn(async (bytes: Uint8Array, deps?: { password?: string }) => {
      if (deps?.password === undefined) throw Object.assign(new Error("password needed"), { code: "password_required" });
      if (deps.password !== password) throw Object.assign(new Error("bad password"), { code: "wrong_password" });
      const session = fakeSession(bytes, ["Hello World"]);
      openedSessions.push(session);
      return session;
    });
    const { adapter, editor } = setup({ createRenderSession });

    const required = await adapter.open.open();
    expect(required).toMatchObject({ outcome: "failed", format: "pdf", failure_class: "password_required" });

    const wrong = await adapter.open.open(undefined, "nope");
    expect(wrong).toMatchObject({ outcome: "failed", format: "pdf", failure_class: "wrong_password" });

    const result = await adapter.open.open(undefined, password);
    expect(result).toMatchObject({ outcome: "opened", document_id: "doc" });
    expect(editor.getPdfSnapshot?.()).toEqual({ pages: [{ pageNumber: 1, rotation: 0 }], pageCount: 1 });

    // Every submit is a fresh attempt: the cached failed open is not reused.
    expect(createRenderSession).toHaveBeenCalledTimes(3);
    expect(createRenderSession.mock.calls[2]).toEqual([original, { password }]);
    expect(openedSessions).toHaveLength(1);
    await adapter.session.dispose();
  });

  it("reads a note added in this session back from the current bytes", async () => {
    const { adapter, editor } = noteSetup();
    await adapter.open.open();
    await editor.submitEngineOperations?.([
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: NOTE_RECT, contents: "Ghi chú tiếng Việt", author: "Nguyễn An" } } },
    ]);
    const threads = await editor.readSavedNotes?.();
    expect(threads).toHaveLength(1);
    const thread = threads![0]!;
    expect(thread.root).toMatchObject({ page: 1, pageIndex: 0, rect: NOTE_RECT, contents: "Ghi chú tiếng Việt", author: "Nguyễn An", binding: "bound" });
    expect(thread.root.resolved).toBeUndefined();
    expect(thread.id).toBe(thread.root.id);
    expect(thread.replies).toEqual([]);
    await adapter.session.dispose();
  });

  it("reports a resolved saved note as resolved", async () => {
    const { adapter, editor } = noteSetup();
    await adapter.open.open();
    await editor.submitEngineOperations?.([
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: NOTE_RECT, contents: "Cần xử lý" } } },
    ]);
    const [before] = (await editor.readSavedNotes?.())!;
    await editor.submitEngineOperations?.([
      { op: "resolveNote", attributes: { pageIndex: 0, objNum: before!.root.objNum, rect: NOTE_RECT, contents: "Cần xử lý", resolved: true } },
    ]);
    const [after] = (await editor.readSavedNotes?.())!;
    expect(after!.root.resolved).toBe(true);
    await adapter.session.dispose();
  });

  it("marks a row the reader skipped as unbound", async () => {
    const rect: [number, number, number, number] = [1, 2, 3, 4];
    const readNotes = vi.fn(async () => ({
      threads: [{ id: "0:4", root: { id: "0:4", page: 1, pageIndex: 0, objNum: 4, rect, contents: "note" }, replies: [] }],
      skipped: [{ pageIndex: 0, objNum: 4, reason: "unreadable" }],
    }));
    const { adapter, editor } = setup({ readNotes });
    await adapter.open.open();
    const threads = await editor.readSavedNotes?.();
    expect(threads![0]!.root.binding).toBe("unbound");
    await adapter.session.dispose();
  });

  it("leaves disposal terminal after a wrong password so cancel still exits", async () => {
    const createRenderSession = vi.fn(async () => { throw Object.assign(new Error("bad password"), { code: "wrong_password" }); });
    const { adapter, editor } = setup({ createRenderSession });
    expect(await adapter.open.open(undefined, "wrong")).toMatchObject({ outcome: "failed", failure_class: "wrong_password" });
    await adapter.session.dispose();
    await expect(editor.open()).rejects.toThrow("pdf_editor_disposed");
  });

  it("trims the undo stack by total bytes instead of entry count", async () => {
    let call = 0;
    const applyOps = vi.fn(async () => ({ bytes: new Uint8Array(12).fill(++call), skipped: [] }));
    // Budget fits a single 12-byte snapshot: the third edit must drop the two
    // oldest entries (5-byte original and the first 12-byte snapshot).
    const { adapter, editor } = setup({ applyOps, undoByteBudget: 20 });
    await adapter.open.open();
    await editor.submitEngineOperations?.([{ op: "a" }]);
    await editor.submitEngineOperations?.([{ op: "b" }]);
    await editor.submitEngineOperations?.([{ op: "c" }]);
    const readBytes = async () => Array.from((await editor.serializeSnapshot(await editor.captureSnapshot())).bytes);
    expect(await readBytes()).toEqual(Array.from(new Uint8Array(12).fill(3)));

    const undone = new Promise<void>((resolve) => { const off = editor.subscribe!(() => { off(); resolve(); }); });
    editor.undo?.();
    await undone;
    expect(await readBytes()).toEqual(Array.from(new Uint8Array(12).fill(2)));

    // Only the newest entry survived the byte budget, so the next undo is a no-op.
    editor.undo?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await readBytes()).toEqual(Array.from(new Uint8Array(12).fill(2)));
    await adapter.session.dispose();
  });

  it("aborts a superseded open without swapping the document", async () => {
    const controller = new AbortController();
    let enteredResolve!: () => void;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sessions: FakeSession[] = [];
    const createRenderSession = vi.fn(async (bytes: Uint8Array) => {
      enteredResolve();
      await gate;
      const session = fakeSession(bytes, ["a"]);
      sessions.push(session);
      return session;
    });
    const { adapter, editor } = setup({ createRenderSession });

    const pending = adapter.open.open(controller.signal);
    await entered;
    controller.abort();
    release();

    await expect(pending).rejects.toThrow("Open cancelled");
    expect(sessions[0]!.disposed).toBe(true);
    expect(editor.getPdfSnapshot?.()).toBeNull();
    expect(editor.openOutcome()).toBeNull();
    await adapter.session.dispose();
  });
});

/** Polls inside act until the check holds (this package has no testing-library). */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

describe("web PDF host through the shared editor (review-fe-r1 R6)", () => {
  it("an Undo pressed while a rotate awaits the engine undoes that rotate instead of being dropped", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let releaseOps: (() => void) | null = null;
    const edited = new Uint8Array([37, 80, 68, 70, 1, 9]);
    const applyOps = vi.fn(async () => { await new Promise<void>((resolve) => { releaseOps = resolve; }); return { bytes: edited, skipped: [] }; });
    const { adapter, editor, sessions } = setup({ applyOps });
    const coordinator = { getState: () => ({ state: "ready" as const, identity, dirtyGeneration: 0, lastSavedGeneration: 0, activeIntentId: null, error: null }), subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn() };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(PdfEditor, { documentKey: "doc-r6", editor, open: adapter.open, coordinator, capability })); });
    const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const button = (name: string) => [...container.querySelectorAll<HTMLElement>("button")].find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name);
    await until(() => byTestId("pdf-canvas") !== null && button("Page 2") !== undefined);
    const undo = byTestId("pdf-chrome-undo")!;
    expect(undo.getAttribute("aria-disabled")).toBe("true");

    await act(async () => { button("Page 2")!.click(); });
    await act(async () => { byTestId("pdf-chrome-tab-pages")!.click(); });
    await act(async () => { button("Rotate page")!.click(); });
    await until(() => releaseOps !== null);
    // The engine has not answered: Undo is offered and the press is kept.
    await until(() => !undo.hasAttribute("aria-disabled"));
    await act(async () => { undo.click(); });
    await act(async () => { releaseOps!(); });

    // The rotate landed, then the queued Undo swapped the original bytes back.
    await until(() => sessions[0]!.bytesSeen.length >= 3);
    expect(Array.from(sessions[0]!.bytesSeen.at(-2)!)).toEqual(Array.from(edited));
    expect(Array.from(sessions[0]!.bytesSeen.at(-1)!)).toEqual(Array.from(original));
    expect(editor.canUndo?.()).toBe(false);
    expect(editor.canRedo?.()).toBe(true);
    await act(async () => root.unmount());
    container.remove();
    await adapter.session.dispose();
  });
});
