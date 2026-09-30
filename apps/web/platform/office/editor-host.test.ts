// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  __clearDraftCleanupRegistryForTest,
  clearRegisteredOfficeDraftMemory,
} from "@uniwork/core/drafts/cleanup-registry";
import type { EditorHandle, OfficeIdentity, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createBrowserOfficeDraftAdapter, createOfficeEditorSession } from "./editor-host-core";

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
    let record: { draftId: string; generation: number; identity: OfficeIdentity } | undefined;
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
});
