// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, isValidElement, StrictMode, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OfficeEditorHost } from "./editor-host";
import { withCoreProvider } from "./with-core-provider.test-helper";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { pptxSessionDivergedError, type PptxEdit } from "@uniwork/office-engine/pptx";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import type { PptxSessionRuntime } from "./pptx-runtime";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // The adapter's import graph registers the per-panel i18n bundles at module
  // load (charts/animations/transitions/show). A mock without getI18n makes
  // that registration throw before any test can run, so it returns a minimal
  // no-op instance: nothing is registered and nothing throws.
  getI18n: () => ({ hasResourceBundle: () => false, addResourceBundle: () => undefined, on: () => undefined }),
}));
vi.mock("@uniwork/office-upstream/pptx-renderer", () => ({
  buildRenderSlide: () => ({ nodes: [], widthPx: 960, heightPx: 540 }),
  makeViewport: (size: { cx: number; cy: number }, fitWidthPx: number) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  // pptx-runtime reads getSlideNotes off the artifact namespace at module load
  // (an optional member); the mock must carry it or the import throws before
  // any test runs. The suite drives a fake runtime, so it is never called.
  getSlideNotes: () => "",
  // Same optional-member read for the Masters panel parser (never called here:
  // the suite drives a fake runtime).
  parseMasterPart: () => null,
  // The real shared canvas (r6 d7768245) mounts PptxEditor, whose deck renderer
  // reads these three optional accessors off the artifact namespace
  // (deck-renderer.ts:89-91). The mock must carry them or the access throws
  // before the mount can render; the fake buildRenderSlide returns an empty
  // tree, so none of them is ever called.
  patternGrid: () => undefined,
  presetPath: () => null,
  presetPolygon: () => null,
  // The deck renderer (W3) builds its canvas font measurer from this class when
  // the artifact carries it; vitest throws on a mock export that is not defined.
  HeuristicMetrics: class HeuristicMetrics {
    metrics = () => ({ ascent: 1, descent: 0.2, lineHeight: 1.2 });
    measure = (text: string) => text.length;
  },
}));
import { createPptxFormatAdapter, makePptxEditorHost, type PptxEditorHandle } from "./pptx-adapter";
import type { PptxDocumentsTransport } from "./pptx-save-transport";

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
  format: "pptx",
  operation: "serialize",
  host: "web",
  engineBuild: "genoffice-test",
  contractRevision: "office-editor-host/1",
  status: "available",
  fidelityWarnings: [],
};

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

function runtime(): PptxSessionRuntime & { edits: PptxEdit[][]; released: string[]; undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> } {
  let revision = 0;
  const edits: PptxEdit[][] = [];
  const released: string[] = [];
  const slides = () => [{ id: "s1", hidden: false, elements: [{ id: "e1", type: "text" }] }];
  return {
    edits,
    released,
    open: vi.fn(async ({ documentId }) => ({ outcome: "opened" as const, document_id: documentId, document_model_ref: "model-1", snapshot: { revision: 0, edits: [] }, warnings: [] })),
    edit: vi.fn(async (_ref, batch) => {
      edits.push([...batch]);
      revision += 1;
      return { revision };
    }),
    snapshot: vi.fn(() => ({ revision, edits: [] })),
    restore: vi.fn(async (_ref, snapshot) => { revision = snapshot.revision; }),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true),
    serialize: vi.fn(async () => ({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output", warnings: [] })),
    slides: vi.fn(slides),
    masterParts: vi.fn(() => [{ partPath: "ppt/slideMasters/slideMaster1.xml", kind: "master" as const, name: "Office Theme" }]),
    masterElements: vi.fn((_ref: string, partPath: string) => (
      partPath === "ppt/slideMasters/slideMaster1.xml"
        ? [{ id: "m1", type: "text", label: "title", box: { x: 10, y: 20, w: 300, h: 80 }, fill: null }]
        : []
    )),
    deck: vi.fn(() => ({ slides: [{ id: "s1", elements: [{ id: "e1", type: "text", text: { paragraphs: [{ runs: [{ text: "Title" }] }] } }] }], size: { cx: 12192000, cy: 6858000 } })),
    release: vi.fn(async (ref) => { released.push(ref); }),
  };
}

function documents(): PptxDocumentsTransport & { uploaded: Blob[]; commits: number } {
  const uploaded: Blob[] = [];
  let commits = 0;
  return {
    uploaded,
    get commits() { return commits; },
    read: vi.fn(async () => new Uint8Array([80, 75, 3, 4])),
    upload: vi.fn(async (file, idempotencyKey) => {
      uploaded.push(file);
      expect(idempotencyKey).toMatch(/^office-key-/);
      return { upload_id: "upload-1", checksum_sha256: "sha256-output", size_bytes: 4, claim_expires_at: "2099-01-01T00:00:00Z" };
    }),
    commit: vi.fn(async (uploadId, baseRevision, idempotencyKey) => {
      commits += 1;
      expect(uploadId).toBe("upload-1");
      expect(baseRevision).toBe("1");
      expect(idempotencyKey).toMatch(/^office-key-/);
      return { document: { id: "doc", revision: "2" }, version: { id: "version-2", checksum_sha256: "sha256-output", size_bytes: 4 } };
    }),
  };
}

const options = (engine: PptxSessionRuntime, files: PptxDocumentsTransport) => ({
  identity,
  session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 },
  runtime: engine,
  documents: files,
  capability,
  draftStore: draftStore(),
  keyProvider: keyProvider(),
});

afterEach(() => vi.restoreAllMocks());

describe("web PPTX format adapter", () => {
  it("opens the downloaded bytes through the runtime and saves exactly once through upload then commit", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createPptxFormatAdapter(options(engine, files));
    expect(isValidElement(adapter.editorView)).toBe(true);
    expect(await adapter.open.open()).toMatchObject({ outcome: "opened", document_model_ref: "model-1" });
    expect(engine.open).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), documentId: "doc" });
    expect(files.read).toHaveBeenCalledTimes(1);

    await adapter.editor.edit([{ op: "set_slide_hidden", slideIndex: 0, hidden: true }]);
    adapter.session.coordinator.markDirty(adapter.editor.getDirtyGeneration());
    const result = await adapter.session.coordinator.save("button");
    expect(result.accepted).toBe(true);
    expect(engine.edits).toEqual([[{ op: "set_slide_hidden", slideIndex: 0, hidden: true }]]);
    expect(files.uploaded).toHaveLength(1);
    expect(files.uploaded[0]!.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(files.commits).toBe(1);
    expect(engine.released).toEqual([]);

    await adapter.session.dispose();
    expect(engine.released).toEqual(["model-1"]);
  });

  it("shares one in-flight open and captures snapshot generations that track edits", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    const results = await Promise.all([adapter.open.open(), adapter.open.open()]);
    expect(results.map((result) => result.outcome)).toEqual(["opened", "opened"]);
    expect(engine.open).toHaveBeenCalledTimes(1);
    const first = await adapter.editor.captureSnapshot();
    expect(first.generation).toBe(0);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }]);
    const second = await adapter.editor.captureSnapshot();
    expect(second.generation).toBe(1);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(adapter.editor.getDirtyGeneration()).toBe(1);
    await adapter.session.dispose();
  });

  it("keeps the engine's too_large class and maps a server upload_bounds error to it (UNI-956)", async () => {
    const engine = runtime();
    vi.mocked(engine.open).mockResolvedValueOnce({ outcome: "failed", document_id: "doc", failure_class: "too_large", message: "input exceeds the byte bound" });
    const first = createPptxFormatAdapter(options(engine, documents()));
    expect(await first.open.open()).toMatchObject({ outcome: "failed", failure_class: "too_large" });
    const second = runtime();
    vi.mocked(second.open).mockRejectedValueOnce(Object.assign(new Error("payload"), { code: "upload_bounds", kind: "byte_bound" }));
    const adapter = createPptxFormatAdapter(options(second, documents()));
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("preserves the native failure class and engine detail on open", async () => {
    const engine = runtime();
    vi.mocked(engine.open).mockResolvedValueOnce({ outcome: "failed", document_id: "doc", failure_class: "corrupted", message: "invalid central directory" });
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", failure_class: "corrupted", message: "invalid central directory" });
    expect(adapter.editor.snapshot()).toBeNull();
    await adapter.session.dispose();
    expect(engine.released).toEqual([]);
  });

  it("reads the live slide's transition and animations through the handle, null before open and after dispose (X1)", async () => {
    const engine = runtime();
    const transition = { kind: "fade" as const, advanceMs: 2000 };
    const animations = [{ spid: 2, elementId: "e1", effect: "fade" as const, trigger: "onClick" as const, durationMs: 500, delayMs: 0 }];
    engine.slideTransition = vi.fn(() => transition);
    engine.slideAnimations = vi.fn(() => animations);
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    expect(adapter.editor.slideTransition(0)).toBeNull();
    expect(adapter.editor.slideAnimations(0)).toBeNull();
    await adapter.open.open();
    expect(adapter.editor.slideTransition(1)).toEqual(transition);
    expect(engine.slideTransition).toHaveBeenCalledWith("model-1", 1);
    expect(adapter.editor.slideAnimations(1)).toEqual(animations);
    await adapter.session.dispose();
    expect(adapter.editor.slideTransition(1)).toBeNull();
    expect(adapter.editor.slideAnimations(1)).toBeNull();
  });

  it("reads null when the runtime binds no transition/animation read (X1)", async () => {
    const adapter = createPptxFormatAdapter(options(runtime(), documents()));
    await adapter.open.open();
    expect(adapter.editor.slideTransition(0)).toBeNull();
    expect(adapter.editor.slideAnimations(0)).toBeNull();
    await adapter.session.dispose();
  });

  it("refuses an edit before open and after dispose", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await expect(adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }])).rejects.toThrow("pptx_editor_not_open");
    await adapter.open.open();
    await adapter.session.dispose();
    await expect(adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }])).rejects.toThrow("pptx_editor_disposed");
  });

  it("applies a recovered draft journal through the runtime restore and keeps the generation", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await adapter.open.open();
    expect(adapter.onRecoverSnapshot).toBeDefined();
    await adapter.onRecoverSnapshot?.({ generation: 3, fingerprint: "fp", value: { revision: 1, edits: [{ op: "set_slide_hidden", slideIndex: 0, hidden: true }] } });
    expect(engine.restore).toHaveBeenCalledWith("model-1", { revision: 1, edits: [{ op: "set_slide_hidden", slideIndex: 0, hidden: true }] });
    expect(adapter.editor.getDirtyGeneration()).toBe(3);
    await adapter.session.dispose();
  });

  it("exposes undo/redo bound to the runtime and marks the deck dirty", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createPptxFormatAdapter(options(engine, files));
    expect(typeof adapter.editor.undo).toBe("function");
    expect(typeof adapter.editor.redo).toBe("function");
    await adapter.open.open();

    adapter.editor.undo();
    adapter.editor.redo();
    expect(engine.undo).toHaveBeenCalledWith("model-1");
    expect(engine.redo).toHaveBeenCalledWith("model-1");
    // Both settled on the runtime's lane; each is a content change, so the
    // generation advanced and the coordinator was told to save it.
    await vi.waitFor(() => expect(adapter.editor.getDirtyGeneration()).toBe(2));
    expect(adapter.session.coordinator.getState().state).toBe("dirty");
    const saved = await adapter.session.coordinator.save("button");
    expect(saved.accepted).toBe(true);
    expect(files.uploaded).toHaveLength(1);
    await adapter.session.dispose();
  });

  it("ignores undo/redo before open, after dispose, and when the runtime refuses", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    // Not open yet: no runtime call, no crash.
    adapter.editor.undo();
    adapter.editor.redo();
    expect(engine.undo).not.toHaveBeenCalled();
    expect(engine.redo).not.toHaveBeenCalled();

    await adapter.open.open();
    // The runtime reporting "nothing to undo" leaves the deck clean.
    vi.mocked(engine.undo).mockResolvedValueOnce(false);
    adapter.editor.undo();
    await vi.waitFor(() => expect(engine.undo).toHaveBeenCalledTimes(1));
    expect(adapter.editor.getDirtyGeneration()).toBe(0);

    await adapter.session.dispose();
    adapter.editor.undo();
    expect(engine.undo).toHaveBeenCalledTimes(1);
  });

  // UNI-927 W12: a diverged session must not look like a no-op undo.
  it("surfaces a diverged runtime session as a dirty deck whose save fails, and swallows a plain refusal", async () => {
    const engine = runtime();
    const files = documents();
    const adapter = createPptxFormatAdapter(options(engine, files));
    await adapter.open.open();

    // A refusal that left the model untouched stays a silent no-op.
    vi.mocked(engine.undo).mockRejectedValueOnce(new Error("pptx_undo_replay_failed"));
    adapter.editor.undo();
    await vi.waitFor(() => expect(engine.undo).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(adapter.editor.getDirtyGeneration()).toBe(0);

    // The diverged refusal marks the deck dirty; the save then refuses loudly.
    const diverged = pptxSessionDivergedError(new Error("fmt_no_element"));
    vi.mocked(engine.redo).mockRejectedValueOnce(diverged);
    vi.mocked(engine.serialize).mockRejectedValue(diverged);
    adapter.editor.redo();
    await vi.waitFor(() => expect(adapter.editor.getDirtyGeneration()).toBe(1));
    expect(adapter.session.coordinator.getState().state).toBe("dirty");
    const saved = await adapter.session.coordinator.save("button");
    expect(saved.accepted).not.toBe(true);
    expect(files.uploaded).toHaveLength(0);
    await adapter.session.dispose();
  });

  it("hands the runtime's minted element ids back through the edit handle", async () => {
    const engine = runtime();
    vi.mocked(engine.edit).mockResolvedValueOnce({ revision: 1, createdIds: ["new_1"] });
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await adapter.open.open();
    const insert: PptxEdit = { op: "add_element", slideIndex: 0, kind: "rect", xPx: 1, yPx: 1, wPx: 10, hPx: 10 };
    expect(await adapter.editor.edit([insert])).toEqual({ revision: 1, createdIds: ["new_1"] });
    // A non-creating edit stays `{ revision }` only.
    expect(await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }])).toEqual({ revision: 1 });
    await adapter.session.dispose();
  });

  it("hands the surface the document title, which names the print job", async () => {
    const adapter = createPptxFormatAdapter({ ...options(runtime(), documents()), title: "Quarterly deck.pptx" });
    expect((adapter.editorView as ReactElement<{ title?: string }>).props.title).toBe("Quarterly deck.pptx");
    await adapter.session.dispose();
  });

  it("reads master parts and elements off the live session and yields [] before open, after dispose or when unbound", async () => {
    type MasterProps = { masterParts: () => readonly unknown[]; masterElements: (partPath: string) => readonly unknown[] };
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    const props = (adapter.editorView as ReactElement<MasterProps>).props;
    // Before open there is no model ref: no runtime call, an empty list.
    expect(props.masterParts()).toEqual([]);
    expect(props.masterElements("ppt/slideMasters/slideMaster1.xml")).toEqual([]);
    expect(engine.masterParts).not.toHaveBeenCalled();

    await adapter.open.open();
    expect(props.masterParts()).toEqual([{ partPath: "ppt/slideMasters/slideMaster1.xml", kind: "master", name: "Office Theme" }]);
    expect(engine.masterParts).toHaveBeenCalledWith("model-1");
    expect(props.masterElements("ppt/slideMasters/slideMaster1.xml")).toEqual([
      { id: "m1", type: "text", label: "title", box: { x: 10, y: 20, w: 300, h: 80 }, fill: null },
    ]);
    expect(engine.masterElements).toHaveBeenCalledWith("model-1", "ppt/slideMasters/slideMaster1.xml");

    await adapter.session.dispose();
    // A disposed session never reaches the freed engine ref.
    vi.mocked(engine.masterParts!).mockClear();
    expect(props.masterParts()).toEqual([]);
    expect(props.masterElements("ppt/slideMasters/slideMaster1.xml")).toEqual([]);
    expect(engine.masterParts).not.toHaveBeenCalled();

    // A runtime that predates the reads degrades to [] instead of throwing.
    const bare = runtime();
    delete (bare as Partial<PptxSessionRuntime>).masterParts;
    delete (bare as Partial<PptxSessionRuntime>).masterElements;
    const bareAdapter = createPptxFormatAdapter(options(bare, documents()));
    await bareAdapter.open.open();
    const bareProps = (bareAdapter.editorView as ReactElement<MasterProps>).props;
    expect(bareProps.masterParts()).toEqual([]);
    expect(bareProps.masterElements("ppt/slideMasters/slideMaster1.xml")).toEqual([]);
    await bareAdapter.session.dispose();
  });

  it("mounts the real shared canvas once the deck is bound and republishes the revision per edit", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await adapter.open.open();
    expect(adapter.editor.deck()).not.toBeNull();
    expect(adapter.editor.revision()).toBe(0);

    const container = document.createElement("div");
    document.body.append(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root!: Root;
    await act(async () => { root = createRoot(container); root.render(adapter.editorView as ReactElement); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // The interim element-list surface is gone; the real canvas is mounted.
    expect(container.querySelector("[data-pptx-session-surface]")).toBeNull();
    expect(container.querySelector("[data-pptx-canvas]")).not.toBeNull();

    // An applied edit advances the published revision (the canvas cache key).
    await act(async () => { await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }]); });
    expect(adapter.editor.revision()).toBe(1);
    await act(async () => { await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }]); });
    expect(adapter.editor.revision()).toBe(2);
    expect(container.querySelector("[data-pptx-canvas]")).not.toBeNull();

    await act(async () => { root.unmount(); });
    container.remove();
    await adapter.session.dispose();
  });

  // F-11: `next dev` mounts every tree twice (mount -> cleanup -> mount). The
  // shared host disposes the session in its unmount cleanup, which used to kill
  // the adapter before the remount opened it ("pptx_editor_disposed").
  async function mountStrict(adapter: ReturnType<typeof createPptxFormatAdapter>) {
    const container = document.createElement("div");
    document.body.append(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // T10: the shared host is the only StrictMode mechanism (its dispose is
    // deferred past the replayed mount); the adapter disposes when asked.
    const officeDocument = {
      id: identity.documentId, workspace_id: identity.workspaceId, organization_id: identity.organizationId, kind: "file", title: "Office document", revision: "1", current_version: 1,
      file: { file_id: "file", version_id: "version-1", version: 1, filename: "document.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size_bytes: 3, checksum_sha256: "sha256:file" },
    } as never;
    let root!: Root;
    await act(async () => { root = createRoot(container); root.render(withCoreProvider(createElement(StrictMode, null, createElement(OfficeEditorHost, { document: officeDocument, wsId: identity.workspaceId, readonly: false, formatAdapter: adapter as never })))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    return { container, root };
  }

  it("survives a StrictMode double mount: the deck renders and the model is not released", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    const { container, root } = await mountStrict(adapter);
    expect(container.querySelector("[data-pptx-open-state=error]")).toBeNull();
    expect(container.querySelector("[data-pptx-canvas]")).not.toBeNull();
    expect(engine.released).toEqual([]);
    expect(adapter.editor.deck()).not.toBeNull();

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
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    const { container, root } = await mountStrict(adapter);
    const retry = container.querySelector("[data-pptx-open-state=error] button") as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    expect(container.querySelector("[data-pptx-open-state=error]")?.textContent).not.toContain("pptx_editor_disposed");
    open.mockImplementation(succeed);
    await act(async () => { retry!.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.querySelector("[data-pptx-canvas]")).not.toBeNull();
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    container.remove();
  });

  it("renders the shared too-large notice when the open is too_large (UNI-956)", async () => {
    const engine = runtime();
    vi.mocked(engine.open).mockResolvedValue({ outcome: "failed", document_id: "doc", failure_class: "too_large", message: "input exceeds the byte bound" });
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    const { container, root } = await mountStrict(adapter);
    expect(container.querySelector("[data-testid=office-too-large]")).not.toBeNull();
    expect(container.querySelector("[data-pptx-open-state=error]")).toBeNull();
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    container.remove();
  });

  it("makes session dispose idempotent and releases the model once", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await adapter.open.open();
    const first = adapter.session.dispose();
    expect(adapter.session.dispose()).toBe(first);
    await first;
    await adapter.session.dispose();
    expect(engine.released).toEqual(["model-1"]);
  });

  it("refuses an open that lands while the fired dispose is still awaiting the draft (F2)", async () => {
    const engine = runtime();
    const opts = options(engine, documents());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    opts.keyProvider.clearMemory = vi.fn(() => gate);
    const adapter = createPptxFormatAdapter(opts);
    await adapter.open.open();
    const disposal = adapter.session.dispose();
    // The deferred timer fires; draft.dispose() is now stuck on the gate while
    // editor.dispose() (which sets `disposed`) has not run yet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(engine.released).toEqual([]);
    await expect(adapter.editor.open()).rejects.toThrow("pptx_editor_disposed");
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed" });
    release();
    await disposal;
    expect(engine.released).toEqual(["model-1"]);
  });

  it("advances the published revision on undo, redo and restore", async () => {
    const engine = runtime();
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    await adapter.open.open();
    await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }]);
    const afterEdit = adapter.editor.revision();

    adapter.editor.undo();
    await vi.waitFor(() => expect(adapter.editor.revision()).toBe(afterEdit + 1));
    adapter.editor.redo();
    await vi.waitFor(() => expect(adapter.editor.revision()).toBe(afterEdit + 2));

    await adapter.onRecoverSnapshot?.({ generation: 1, fingerprint: "fp", value: { revision: 1, edits: [] } });
    expect(adapter.editor.revision()).toBe(afterEdit + 3);
    await adapter.session.dispose();
  });

  it("refuses the shared host read ports instead of fabricating an open or a blank package (F3)", async () => {
    const edit = vi.fn(async () => ({ revision: 1 }));
    const host = makePptxEditorHost({ edit } as unknown as PptxEditorHandle, true);
    // readDocument has no failure channel: it refuses by name, never an empty Uint8Array.
    await expect(host.read.readDocument("doc")).rejects.toBeInstanceOf(HostCapabilityRefusal);
    await expect(host.read.readDocument("doc")).rejects.toMatchObject({ reason: "unsupported" });
    // openDocument owns the OpenOutcome failure channel: a named failure, never a
    // fabricated "opened" with a bogus model ref.
    await expect(host.read.openDocument("doc", "pptx")).resolves.toMatchObject({
      outcome: "failed",
      document_id: "doc",
      format: "pptx",
      failure_class: "unsupported_feature",
    });
  });

  it("passes groupId through the transform channel and refuses it when readonly (F5/F6)", async () => {
    const edit = vi.fn(async () => ({ revision: 1 }));
    const host = makePptxEditorHost({ edit } as unknown as PptxEditorHandle, true);
    await host.ipc.call("host:slides-edit-transform", { slideIndex: 0, sourceId: "e1", xPx: 1, yPx: 2, wPx: 3, hPx: 4, groupId: "g1" });
    expect(edit).toHaveBeenCalledWith([expect.objectContaining({ op: "edit_transform", elementId: "e1", groupId: "g1" })]);

    // A readonly document binds no transform: the channel refuses by policy
    // before the engine is touched, matching the readonly edit refusal.
    const readonlyHost = makePptxEditorHost({ edit } as unknown as PptxEditorHandle, false);
    await expect(readonlyHost.ipc.call("host:slides-edit-transform", { slideIndex: 0, sourceId: "e1", xPx: 1, yPx: 2, wPx: 3, hPx: 4 }))
      .rejects.toMatchObject({ reason: "policy" });
  });

  it("keeps a readonly document from editing and from writing to the cloud", async () => {
    const engine = runtime();
    const files = documents();
    const readonly = { ...capability, status: "readonly" as const, reason: "read only" };
    const adapter = createPptxFormatAdapter({ ...options(engine, files), capability: readonly, readonly: true });
    await adapter.open.open();
    // F4: the host passes readonly, so the edit is refused before the model
    // can carry dirty state the capability gate would never let save.
    await expect(adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }])).rejects.toThrow("pptx_editor_readonly");
    expect(engine.edits).toHaveLength(0);
    expect(adapter.editor.getDirtyGeneration()).toBe(0);
    expect(await adapter.session.coordinator.save("button")).toEqual({ accepted: false, reason: "readonly" });
    expect(files.uploaded).toHaveLength(0);
    await adapter.session.dispose();
  });
});

describe("web PPTX adapter: the commit's journal rebase is a marked rebase window (T09 r2)", () => {
  // r3 contract: a capture that outlived the bound writes while the Save hangs,
  // under the identity bound at that moment. A capture straddling either edge
  // of the rebase step is retaken, so a pre-rebase journal never lands under
  // the moved base. A retake that runs wholly inside the step reads the
  // post-rebase tail and writes it under the pre-save base: a conflict-only
  // row, disclosed in r3. Every step below waits on a promise or a recorded
  // row, never on which of a digest and a timer resolves first.
  it("retakes a timed-out capture that straddles the start of setBaseRevision; the retake inside the step writes the tail under the pre-save base", async () => {
    const engine = runtime();
    // A base-relative journal: setBaseRevision drops the prefix the Save holds.
    let journal: PptxEdit[] = [];
    let saved = 0;
    vi.mocked(engine.edit).mockImplementation(async (_ref, batch) => { journal.push(...batch); return { revision: journal.length }; });
    vi.mocked(engine.snapshot).mockImplementation(() => ({ revision: journal.length, edits: [...journal] as never }));
    vi.mocked(engine.serialize).mockImplementation(async () => { saved = journal.length; return { bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output", warnings: [] }; });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let endStep!: () => void;
    const stepHeld = new Promise<void>((resolve) => { endStep = resolve; });
    let stepEntered = false;
    engine.setBaseRevision = vi.fn(async () => {
      stepEntered = true;
      journal = journal.slice(saved);
      // The first capture, holding the pre-rebase journal, resolves inside the step.
      releaseRead();
      await stepHeld;
    });
    const files = documents();
    let finishCommit!: () => void;
    const commitHeld = new Promise<void>((resolve) => { finishCommit = resolve; });
    const commit = files.commit;
    files.commit = vi.fn(async (...args: Parameters<typeof commit>) => { await commitHeld; return commit(...args); });
    const store = draftStore();
    const editsOf = (ciphertext: Uint8Array) => (JSON.parse(new TextDecoder().decode(ciphertext)) as { value: { edits: unknown[] } }).value.edits.length;
    const rows: Array<{ base: string; edits: number }> = [];
    const rebased: Array<{ base: string; edits: number }> = [];
    vi.mocked(store.checkpointEncrypted).mockImplementation(async (request) => {
      rows.push({ base: request.snapshot.identity.base.revision, edits: editsOf(request.snapshot.ciphertext) });
      return { status: "stored", metadata: {} } as never;
    });
    vi.mocked(store.rebaseEncrypted).mockImplementation(async (request) => {
      rebased.push({ base: request.snapshot.identity.base.revision, edits: editsOf(request.snapshot.ciphertext) });
      return { status: "stored", metadata: {} } as never;
    });
    const keys = keyProvider();
    vi.mocked(keys.encrypt).mockImplementation(async ({ plaintext }) => ({ ciphertext: plaintext, wrappedKey: new Uint8Array([1]), checksum: "sha256:1" }));
    const opts = { ...options(engine, files), draftStore: store, keyProvider: keys, saveSettleMaxWaitMs: 5 };
    const adapter = createPptxFormatAdapter(opts);
    await adapter.open.open();
    await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }]);
    const saving = adapter.session.coordinator.save("button");
    await vi.waitFor(() => expect(files.commit).toHaveBeenCalledOnce());
    await adapter.editor.edit([{ op: "set_slide_hidden", slideIndex: 0, hidden: true }]);
    // The checkpoint's capture starts once the bound runs out and reads the
    // pre-rebase journal (both edits), then is held until the step has begun.
    const capture = adapter.session.editor.captureSnapshot.bind(adapter.session.editor);
    let reads = 0;
    adapter.session.editor.captureSnapshot = async () => { reads += 1; const value = await capture(); if (reads === 1) await readGate; return value; };
    const checkpointing = adapter.session.checkpoint();
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(rows).toEqual([]);
    finishCommit();
    // The step is held open: the first capture straddled its start and is
    // retaken; the retake reads the tail and writes inside the step, under
    // the identity still bound (the pre-save base).
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    await checkpointing;
    expect(stepEntered).toBe(true);
    expect(reads).toBe(2);
    expect(rows).toEqual([{ base: "1", edits: 1 }]);
    endStep();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    // The Save's own draft rebase carries the unsaved tail to the saved base,
    // and a later checkpoint writes there too. No pre-rebase journal (two
    // edits) ever lands under the moved base.
    expect(rebased).toEqual([{ base: "2", edits: 1 }]);
    await adapter.session.checkpoint();
    expect(rows.at(-1)).toEqual({ base: "2", edits: 1 });
    expect([...rows, ...rebased].filter((row) => row.base === "2" && row.edits !== 1)).toEqual([]);
    await adapter.session.dispose();
  });
});
