// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  __clearDraftCleanupRegistryForTest,
  clearRegisteredOfficeDraftMemory,
} from "@uniwork/core/drafts/cleanup-registry";
import type { DraftIdentity, EditorHandle, OfficeIdentity, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createBrowserOfficeDraftAdapter, createOfficeEditorSession } from "./editor-host-core";
import { createFakeOfficeTransport } from "../../../../packages/core/office/test-fakes";

const identity: OfficeIdentity = {
  deploymentId: "deployment",
  accountId: "account",
  organizationId: "org",
  workspaceId: "workspace",
  documentId: "document",
  generation: 1,
  baseVersionId: "version-1",
  baseRevision: "1",
};
const session = { sessionId: "session", deploymentId: "deployment", accountId: "account", generation: 1 } as const;

function fakeStore() {
  return {
    checkpointEncrypted: vi.fn(async () => ({ status: "stored", metadata: { draftId: "document", identity: { deploymentId: "deployment", accountId: "account", organizationId: "org", workspaceId: "workspace", documentId: "document", base: { revision: "1", version: "version-1" } }, generation: 1, checksum: "sha256:1", byteLength: 3, updatedAt: 1 } })),
    rebaseEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    clearMemory: vi.fn(),
    list: vi.fn(async () => []),
    recoverEncrypted: vi.fn(async () => ({ status: "missing" as const })),
    deleteDurable: vi.fn(async () => undefined),
  } as unknown as IndexedDbDraftStore;
}

function fakeKeyProvider(): DraftKeyProvider {
  return {
    encrypt: vi.fn(async () => ({ ciphertext: new Uint8Array([1, 2, 3]), wrappedKey: new Uint8Array([4]), checksum: "sha256:1" })),
    recover: vi.fn(),
    decrypt: vi.fn(),
    clearMemory: vi.fn(async () => undefined),
    registerCleanup: vi.fn(() => () => undefined),
  };
}

beforeEach(() => __clearDraftCleanupRegistryForTest());
afterEach(() => __clearDraftCleanupRegistryForTest());

describe("browser Office host draft adapter", () => {
  it("writes encrypted checkpoints to the draft store without invoking cloud transport", async () => {
    const store = fakeStore();
    const keyProvider = fakeKeyProvider();
    const adapter = createBrowserOfficeDraftAdapter({ identity, session, draftStore: store, keyProvider });
    const snapshot: StableSnapshot<{ text: string }> = { generation: 1, fingerprint: "fp", value: { text: "draft" } };
    await adapter.checkpointDurable(snapshot);
    expect(vi.mocked(keyProvider.encrypt)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.checkpointEncrypted)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.checkpointEncrypted).mock.calls[0]?.[0].snapshot.ciphertext).toEqual(new Uint8Array([1, 2, 3]));
    await adapter.dispose();
  });

  it("registers memory cleanup while retaining durable ciphertext", async () => {
    const store = fakeStore();
    const keyProvider = fakeKeyProvider();
    const adapter = createBrowserOfficeDraftAdapter({ identity, session, draftStore: store, keyProvider });
    clearRegisteredOfficeDraftMemory();
    await Promise.resolve();
    expect(store.clearMemory).toHaveBeenCalledTimes(1);
    expect(keyProvider.clearMemory).toHaveBeenCalledTimes(1);
    expect(store.deleteDurable).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  it("does not delete a newer durable checkpoint when Save N settles", async () => {
    const store = fakeStore();
    vi.mocked(store.list).mockResolvedValue([
      { draftId: "document", generation: 2, identity: identity as never, checksum: "sha256:2", byteLength: 3, updatedAt: 2 },
    ] as never);
    const adapter = createBrowserOfficeDraftAdapter({ identity, session, draftStore: store, keyProvider: fakeKeyProvider() });
    await expect(adapter.discard(identity, 1)).resolves.toBeUndefined();
    expect(store.deleteDurable).not.toHaveBeenCalled();
    await expect(adapter.discard(identity, 2)).resolves.toBeUndefined();
    expect(store.deleteDurable).toHaveBeenCalledWith({ session, draftId: "document", generation: 2 });
    await adapter.dispose();
  });

  it("does not let an in-flight checkpoint recreate a draft after Save discards it", async () => {
    let releaseCheckpoint!: () => void;
    let checkpointStarted!: () => void;
    const started = new Promise<void>((resolve) => { checkpointStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    let record: { draftId: string; generation: number; identity: OfficeIdentity | DraftIdentity } | undefined;
    const store = fakeStore();
    vi.mocked(store.checkpointEncrypted).mockImplementation(async ({ snapshot }) => {
      checkpointStarted();
      await released;
      record = { draftId: snapshot.draftId, generation: snapshot.generation, identity: identity as never };
      return { status: "stored", metadata: {} } as never;
    });
    vi.mocked(store.list).mockImplementation(async () => (record ? [record as never] : []));
    vi.mocked(store.deleteDurable).mockImplementation(async ({ generation }) => {
      if (record?.generation === generation) record = undefined;
    });
    const adapter = createBrowserOfficeDraftAdapter({ identity, session, draftStore: store, keyProvider: fakeKeyProvider() });
    const checkpoint = adapter.checkpointDurable({ generation: 1, fingerprint: "fp", value: { text: "draft" } });
    await started;
    const discard = adapter.discardDurable(1);
    releaseCheckpoint();
    await Promise.all([checkpoint, discard]);
    expect(record).toBeUndefined();
    await adapter.dispose();
  });

  it("does not let the host checkpoint timer recreate the draft a Save already consumed", async () => {
    let record: { draftId: string; generation: number; identity: OfficeIdentity | DraftIdentity } | undefined;
    const store = fakeStore();
    vi.mocked(store.checkpointEncrypted).mockImplementation(async ({ snapshot }) => {
      record = { draftId: snapshot.draftId, generation: snapshot.generation, identity: snapshot.identity };
      return { status: "stored", metadata: {} } as never;
    });
    vi.mocked(store.list).mockImplementation(async () => (record ? [{ ...record, byteLength: 1, updatedAt: 1 } as never] : []));
    vi.mocked(store.deleteDurable).mockImplementation(async ({ generation }) => {
      if (record?.generation === generation) record = undefined;
    });
    const adapter = createBrowserOfficeDraftAdapter({ identity, session, draftStore: store, keyProvider: fakeKeyProvider() });
    await adapter.checkpointDurable({ generation: 1, fingerprint: "fp", value: { text: "edit" } });
    expect(record).toBeDefined();
    await adapter.discardDurable(1);
    expect(record).toBeUndefined();
    // The 2s host timer fires after the Save and asks for the same generation
    // again; the durable draft must not come back (F-6 stale offer on reload).
    await adapter.checkpointDurable({ generation: 1, fingerprint: "fp", value: { text: "edit" } });
    expect(record).toBeUndefined();
    expect(vi.mocked(store.checkpointEncrypted)).toHaveBeenCalledTimes(1);
    await adapter.dispose();
  });

  it("checkpointing marks dirty but never uses coordinator upload or commit", async () => {
    const editor: EditorHandle<{ text: string }> = {
      format: "md",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text: "draft" } })),
      dispose: vi.fn(),
    };
    const transport: OfficeSaveTransport<{ text: string }> = {
      serialize: vi.fn(), upload: vi.fn(), commit: vi.fn(), reconcile: vi.fn(),
    };
    const sessionHost = createOfficeEditorSession({ identity, session, editor, transport, draftStore: fakeStore(), keyProvider: fakeKeyProvider() });
    await sessionHost.checkpoint();
    expect(transport.serialize).not.toHaveBeenCalled();
    expect(transport.upload).not.toHaveBeenCalled();
    expect(transport.commit).not.toHaveBeenCalled();
    await sessionHost.dispose();
  });

  it("recovers N+1 against the committed base after Save N and a fresh session", async () => {
    type Snapshot = { text: string };
    let generation = 0;
    let record: Parameters<IndexedDbDraftStore["checkpointEncrypted"]>[0] | null = null;
    const store = fakeStore();
    vi.mocked(store.checkpointEncrypted).mockImplementation(async (request) => {
      record = request;
      return { status: "stored", metadata: {} } as never;
    });
    vi.mocked(store.rebaseEncrypted).mockImplementation(async (request) => {
      record = request;
      return { status: "stored", metadata: {} } as never;
    });
    vi.mocked(store.list).mockImplementation(async () => record ? [{ ...record.snapshot, byteLength: 1, updatedAt: 1 }] : []);
    vi.mocked(store.recoverEncrypted).mockImplementation(async ({ currentBase }) => {
      if (!record) return { status: "missing" };
      if (currentBase.revision !== record.snapshot.identity.base.revision) return { status: "conflict" } as never;
      return { status: "recovered", metadata: { ...record.snapshot, byteLength: 1, updatedAt: 1 }, ciphertext: record.snapshot.ciphertext, wrappedKey: record.wrappedKey };
    });
    const provider = fakeKeyProvider();
    vi.mocked(provider.encrypt).mockImplementation(async ({ plaintext }) => ({ ciphertext: plaintext, wrappedKey: new Uint8Array([1]), checksum: "sha256:checkpoint" }));
    vi.mocked(provider.decrypt).mockImplementation(async ({ ciphertext }) => ciphertext);
    const editor: EditorHandle<Snapshot> = {
      format: "md", open: vi.fn(), dispose: vi.fn(),
      getDirtyGeneration: () => generation,
      captureSnapshot: async () => ({ generation, fingerprint: `fp-${generation}`, value: { text: `edit-${generation}` } }),
    };
    const transport = createFakeOfficeTransport<Snapshot>();
    transport.serializedOutput = { data: new Uint8Array([1]), checksumSha256: "sha", sizeBytes: 1, format: "md" };
    let finishCommit!: () => void;
    transport.commit = vi.fn(({ intent }) => new Promise((resolve) => {
      finishCommit = () => resolve({ intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "document", versionId: "version-2", revision: "2", checksumSha256: "sha", sizeBytes: 1, engineName: "test", engineVersion: "1", contractVersion: "1", protocolVersion: "1" });
    }));
    const host = createOfficeEditorSession({ identity, session, editor, transport, draftStore: store, keyProvider: provider });
    generation = 1;
    await host.checkpoint();
    const saving = host.coordinator.save();
    await vi.waitFor(() => expect(transport.commit).toHaveBeenCalledOnce());
    generation = 2;
    // A checkpoint asked for mid-save waits for the Save to settle (T09).
    const checkpointing = host.checkpoint();
    finishCommit();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    await checkpointing;
    expect(host.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 });
    expect(store.rebaseEncrypted).toHaveBeenCalledOnce();
    expect(await host.recoverDraft()).toMatchObject({ status: "recovered", snapshot: { generation: 2, value: { text: "edit-2" } } });
    const reopened = createOfficeEditorSession({ identity: { ...identity, baseRevision: "2", baseVersionId: "version-2" }, session, editor, transport, draftStore: store, keyProvider: provider });
    expect(await reopened.recoverDraft()).toMatchObject({ status: "recovered", snapshot: { generation: 2, value: { text: "edit-2" } }, metadata: { identity: { base: { revision: "2" } } } });
    await host.dispose();
    await reopened.dispose();
  });
});

/** A base-relative editor (the pptx/xlsx journal shape): a commit rebases it
 *  onto the saved bytes, so a snapshot is only valid under the base it was
 *  read at. `holdNextCapture` keeps the next capture's digest pending. */
function journalHost(format: "docx" | "xlsx" | "pptx") {
  type Journal = { base: string; edits: string[] };
  const doc = { base: "1", edits: [] as string[], generation: 0 };
  let holdArmed = false;
  let releaseDigest!: () => void;
  const digest = new Promise<void>((resolve) => { releaseDigest = resolve; });
  const rows: Array<{ base: string; generation: number; value: Journal }> = [];
  const store = fakeStore();
  const decodeRow = (request: Parameters<IndexedDbDraftStore["checkpointEncrypted"]>[0]) => {
    rows.push({ base: request.snapshot.identity.base.revision, generation: request.snapshot.generation, value: (JSON.parse(new TextDecoder().decode(request.snapshot.ciphertext)) as StableSnapshot<Journal>).value });
    return { status: "stored", metadata: {} } as never;
  };
  vi.mocked(store.checkpointEncrypted).mockImplementation(async (request) => decodeRow(request));
  vi.mocked(store.rebaseEncrypted).mockImplementation(async (request) => decodeRow(request));
  const keyProvider = fakeKeyProvider();
  vi.mocked(keyProvider.encrypt).mockImplementation(async ({ plaintext }) => ({ ciphertext: plaintext, wrappedKey: new Uint8Array([1]), checksum: "sha256:checkpoint" }));
  const editor: EditorHandle<Journal> = {
    format, open: vi.fn(), dispose: vi.fn(),
    getDirtyGeneration: () => doc.generation,
    captureSnapshot: async () => {
      const value = { base: doc.base, edits: [...doc.edits] };
      const generation = doc.generation;
      if (holdArmed) { holdArmed = false; await digest; }
      return { generation, fingerprint: `fp-${generation}`, value };
    },
  };
  const transport = createFakeOfficeTransport<Journal>();
  transport.serializedOutput = { data: new Uint8Array([1]), checksumSha256: "sha", sizeBytes: 1, format };
  let finishCommit!: () => void;
  transport.commit = vi.fn(({ intent }) => new Promise((resolve) => {
    finishCommit = () => {
      // The runtime rebases inside commit (setBaseRevision) before the receipt.
      doc.edits = doc.edits.slice((intent.snapshot as Journal).edits.length);
      doc.base = "2";
      resolve({ intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "document", versionId: "version-2", revision: "2", checksumSha256: "sha", sizeBytes: 1, engineName: "test", engineVersion: "1", contractVersion: "1", protocolVersion: "1" });
    };
  }));
  const host = createOfficeEditorSession({ identity, session, editor, transport, draftStore: store, keyProvider });
  const edit = (name: string) => { doc.edits.push(name); doc.generation += 1; host.coordinator.markDirty(doc.generation); };
  return { host, transport, rows, edit, releaseDigest, finishCommit: () => finishCommit(), armHold: () => { holdArmed = true; }, disarmHold: () => { holdArmed = false; } };
}

describe.each(["docx", "xlsx", "pptx"] as const)("%s draft re-capture settle gate (T09)", (format) => {
  it("never writes a pre-rebase journal under the new base when a checkpoint is asked for mid-save", async () => {
    const { host, transport, rows, edit, releaseDigest, armHold, disarmHold, finishCommit } = journalHost(format);
    edit("e1");
    edit("e2");
    const saving = host.coordinator.save();
    await vi.waitFor(() => expect(transport.commit).toHaveBeenCalledOnce());
    edit("e3");
    // Ungated, this capture reads the full pre-rebase journal and its digest
    // outlives the whole commit, settle and draft rebase.
    armHold();
    const checkpointing = host.checkpoint();
    disarmHold();
    finishCommit();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    releaseDigest();
    await checkpointing;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows.filter((candidate) => candidate.base === "2")) {
      expect(row.value).toEqual({ base: "2", edits: ["e3"] });
    }
    expect(rows.at(-1)).toMatchObject({ base: "2", generation: 3, value: { base: "2", edits: ["e3"] } });
    await host.dispose();
  });
});
