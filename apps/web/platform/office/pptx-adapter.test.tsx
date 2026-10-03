// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import type { PptxSessionRuntime } from "./pptx-runtime";
import { createPptxFormatAdapter } from "./pptx-adapter";
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

function runtime(): PptxSessionRuntime & { edits: PptxEdit[][]; released: string[] } {
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
    serialize: vi.fn(async () => ({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output", warnings: [] })),
    slides: vi.fn(slides),
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
