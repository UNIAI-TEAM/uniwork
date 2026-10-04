// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, isValidElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
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

  it("preserves the native failure class and engine detail on open", async () => {
    const engine = runtime();
    vi.mocked(engine.open).mockResolvedValueOnce({ outcome: "failed", document_id: "doc", failure_class: "corrupted", message: "invalid central directory" });
    const adapter = createPptxFormatAdapter(options(engine, documents()));
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", failure_class: "corrupted", message: "invalid central directory" });
    expect(adapter.editor.snapshot()).toBeNull();
    await adapter.session.dispose();
    expect(engine.released).toEqual([]);
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
