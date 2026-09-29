import { describe, expect, it, vi } from "vitest";
import { createFakeOfficeTransport } from "./test-fakes";
import { createOfficeSaveCoordinator } from "./save-coordinator";
import type { DraftAdapter, EditorHandle, OfficeIdentity, OfficeSaveIntent, OfficeSaveReceipt, StableSnapshot } from "./host-contract";

const identity: OfficeIdentity = {
  deploymentId: "dep-1",
  accountId: "acct-1",
  organizationId: "org-1",
  workspaceId: "ws-1",
  documentId: "doc-1",
  generation: 1,
  baseVersionId: "version-1",
  baseRevision: "9007199254740993",
};

function setup() {
  let dirtyGeneration = 0;
  const editor: EditorHandle<{ text: string }> = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => dirtyGeneration,
    captureSnapshot: vi.fn(async () => ({ generation: dirtyGeneration, fingerprint: `fp-${dirtyGeneration}`, value: { text: `draft-${dirtyGeneration}` } })),
    dispose: vi.fn(),
  };
  const draft: DraftAdapter<{ text: string }> = {
    checkpoint: vi.fn(async () => undefined),
    recover: vi.fn(async () => null),
    discard: vi.fn(async () => undefined),
    persistIntent: vi.fn(async () => undefined),
    loadIntent: vi.fn(async () => null),
    clearIntent: vi.fn(async () => undefined),
  };
  const transport = createFakeOfficeTransport<{ text: string }>();
  transport.serializedOutput = { data: new Uint8Array([1, 2]), checksumSha256: "sha", sizeBytes: 2, format: "md" };
  transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
    transport.commitCalls += 1;
    return receipt(intent);
  });
  const coordinator = createOfficeSaveCoordinator({
    identity,
    editor,
    draft,
    transport,
    idFactory: (prefix) => `${prefix}-fixed`,
    now: () => 100,
  });
  return {
    editor,
    draft,
    transport,
    coordinator,
    setDirty: (generation: number) => {
      dirtyGeneration = generation;
      coordinator.markDirty(generation);
    },
  };
}

function receipt(intent: OfficeSaveIntent<{ text: string }>): OfficeSaveReceipt {
  return {
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    documentId: intent.identity.documentId,
    versionId: "version-2",
    revision: "9007199254740994",
    checksumSha256: "sha",
    sizeBytes: 2,
    engineName: "genoffice",
    engineVersion: "engine-1",
    contractVersion: "contract-1",
    protocolVersion: "1",
  };
}

describe("Office save coordinator", () => {
  it("does not create cloud calls during ten minutes of idle time", async () => {
    vi.useFakeTimers();
    try {
      const { setDirty, transport, coordinator } = setup();
      setDirty(1);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(transport.serializeCalls).toBe(0);
      expect(transport.uploadCalls).toBe(0);
      expect(transport.commitCalls).toBe(0);
      expect(coordinator.getState().state).toBe("dirty");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses Save from every entry point while saving and never queues", async () => {
    const { setDirty, transport, coordinator } = setup();
    let resolveCommit: (() => void) | undefined;
    let pendingIntent: OfficeSaveIntent<{ text: string }> | undefined;
    transport.commit = vi.fn((input: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      pendingIntent = input.intent;
      resolveCommit = () => resolve(receipt(input.intent));
    }));
    setDirty(1);
    const first = coordinator.save("button");
    await Promise.resolve();
    await expect(coordinator.save("menu")).resolves.toEqual({ accepted: false, reason: "saving" });
    await expect(coordinator.save("shortcut")).resolves.toEqual({ accepted: false, reason: "saving" });
    await expect(coordinator.save("dialog")).resolves.toEqual({ accepted: false, reason: "saving" });
    expect(transport.commit).toHaveBeenCalledTimes(1);
    expect(pendingIntent?.idempotencyKey).toBe("office-key-fixed");
    resolveCommit?.();
    await first;
    expect(transport.commit).toHaveBeenCalledTimes(1);
  });

  it("refuses a synchronous double-click before snapshot capture resolves", async () => {
    const { editor, setDirty, transport, coordinator } = setup();
    let resolveSnapshot: ((snapshot: { generation: number; fingerprint: string; value: { text: string } }) => void) | undefined;
    editor.captureSnapshot = vi.fn(() => new Promise<StableSnapshot<{ text: string }>>((resolve) => {
      resolveSnapshot = resolve;
    }));
    setDirty(1);
    const first = coordinator.save("button");
    await expect(coordinator.save("shortcut")).resolves.toEqual({ accepted: false, reason: "saving" });
    resolveSnapshot?.({ generation: 1, fingerprint: "fp-1", value: { text: "draft-1" } });
    await first;
    expect(transport.commit).toHaveBeenCalledTimes(1);
  });

  it("keeps N+1 dirty after receipt N and advances the base revision as a string", async () => {
    const { setDirty, transport, coordinator } = setup();
    let resolveCommit: (() => void) | undefined;
    transport.commit = vi.fn((input: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(receipt(input.intent));
    }));
    setDirty(1);
    const save = coordinator.save();
    await vi.waitFor(() => expect(transport.commit).toHaveBeenCalledTimes(1));
    setDirty(2);
    resolveCommit?.();
    const result = await save;
    expect(result.accepted).toBe(true);
    expect(coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 });
    expect(coordinator.getState().identity.baseRevision).toBe("9007199254740994");
  });

  it("reconciles a timeout after commit with the same durable intent", async () => {
    const { setDirty, transport, coordinator } = setup();
    transport.commit = vi.fn(async () => {
      throw { code: "engine_timeout", error_class: "engine", status: 504, retryable: true };
    });
    transport.reconcile = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => receipt(intent));
    setDirty(1);
    const result = await coordinator.save();
    expect(result.accepted).toBe(true);
    expect(transport.commit).toHaveBeenCalledTimes(1);
    expect(transport.reconcile).toHaveBeenCalledTimes(1);
    expect(coordinator.getState().state).toBe("saved");
  });

  it("retries a timed-out intent with the same key and commits once", async () => {
    const { setDirty, transport, coordinator } = setup();
    const keys: string[] = [];
    let attempts = 0;
    transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
      keys.push(intent.idempotencyKey);
      attempts += 1;
      if (attempts === 1) throw { code: "engine_timeout", error_class: "engine", status: 504, retryable: true };
      return receipt(intent);
    });
    transport.reconcile = vi.fn(async () => null);
    setDirty(1);
    const result = await coordinator.save();
    expect(result.accepted).toBe(true);
    expect(transport.commit).toHaveBeenCalledTimes(2);
    expect(new Set(keys)).toEqual(new Set(["office-key-fixed"]));
    expect(coordinator.getState().state).toBe("saved");
  });

  it("keeps an ambiguous pending intent when a newer edit arrives", async () => {
    const { setDirty, transport, coordinator } = setup();
    const keys: string[] = [];
    let allowCommit = false;
    transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
      keys.push(intent.idempotencyKey);
      if (!allowCommit) throw { code: "engine_timeout", error_class: "engine", status: 504, retryable: true };
      return receipt(intent);
    });
    transport.reconcile = vi.fn(async () => null);
    setDirty(1);
    const first = await coordinator.save();
    expect(first.accepted).toBe(false);
    setDirty(2);
    allowCommit = true;
    const second = await coordinator.save("button");
    expect(second.accepted).toBe(true);
    expect(new Set(keys)).toEqual(new Set(["office-key-fixed"]));
    expect(coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 });
  });

  it("keeps the base on a stale conflict and stops key reuse with another payload", async () => {
    const conflict = setup();
    conflict.transport.commit = vi.fn(async () => {
      throw { code: "document_version_conflict", error_class: "conflict", status: 409 };
    });
    conflict.setDirty(1);
    await conflict.coordinator.save();
    expect(conflict.coordinator.getState()).toMatchObject({ state: "conflict", identity: { baseRevision: "9007199254740993" } });

    const mismatch = setup();
    mismatch.transport.commit = vi.fn(async () => {
      throw { code: "idempotency_payload_mismatch", error_class: "conflict", status: 409 };
    });
    mismatch.setDirty(1);
    await mismatch.coordinator.save();
    expect(mismatch.coordinator.getState().state).toBe("error");
    expect(mismatch.transport.commit).toHaveBeenCalledTimes(1);
  });

  it("never enters saved on a malformed commit receipt", async () => {
    const { setDirty, transport, coordinator } = setup();
    transport.commit = vi.fn(async () => ({ documentId: "doc-1", revision: "not-a-revision" }));
    setDirty(1);
    const result = await coordinator.save();
    expect(result.accepted).toBe(false);
    expect(coordinator.getState().state).toBe("error");
    expect(coordinator.getState().activeIntentId).toBeTruthy();
  });
});
