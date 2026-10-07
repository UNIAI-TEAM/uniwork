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

const BASE_REVISION = 9007199254740993n;

const capability = (status: "available" | "readonly" | "unavailable" | "unknown") => ({
  format: "md" as const,
  operation: "serialize",
  host: "web",
  engineBuild: "engine-1",
  contractRevision: "office-editor-host/1",
  status,
  reason: status === "available" ? null : `provider says ${status}`,
  fidelityWarnings: [],
});

function setup() {
  let dirtyGeneration = 0;
  let revisionNumber = BASE_REVISION;
  let idSequence = 0;
  const editor: EditorHandle<{ text: string }> = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => dirtyGeneration,
    captureSnapshot: vi.fn(async () => ({ generation: dirtyGeneration, fingerprint: `fp-${dirtyGeneration}`, value: { text: `draft-${dirtyGeneration}` } })),
    dispose: vi.fn(),
  };
  const persistedIntents: OfficeSaveIntent<{ text: string }>[] = [];
  const clearedIntentIds: string[] = [];
  const draft: DraftAdapter<{ text: string }> = {
    checkpoint: vi.fn(async () => undefined),
    recover: vi.fn(async () => null),
    discard: vi.fn(async () => undefined),
    persistIntent: vi.fn(async (intent: OfficeSaveIntent<{ text: string }>) => {
      persistedIntents.push(intent);
    }),
    loadIntent: vi.fn(async () => null),
    clearIntent: vi.fn(async (intentId: string) => {
      clearedIntentIds.push(intentId);
    }),
  };
  const transport = createFakeOfficeTransport<{ text: string }>();
  transport.serializedOutput = { data: new Uint8Array([1, 2]), checksumSha256: "sha", sizeBytes: 2, format: "md" };
  const receiptFor = (intent: OfficeSaveIntent<{ text: string }>): OfficeSaveReceipt => {
    revisionNumber += 1n;
    return {
      intentId: intent.intentId,
      idempotencyKey: intent.idempotencyKey,
      documentId: intent.identity.documentId,
      versionId: `version-${revisionNumber}`,
      revision: revisionNumber.toString(),
      checksumSha256: "sha",
      sizeBytes: 2,
      engineName: "genoffice",
      engineVersion: "engine-1",
      contractVersion: "contract-1",
      protocolVersion: "1",
    };
  };
  transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
    transport.commitCalls += 1;
    return receiptFor(intent);
  });
  const coordinator = createOfficeSaveCoordinator({
    identity,
    editor,
    draft,
    transport,
    idFactory: (prefix) => `${prefix}-${++idSequence}`,
    now: () => 100,
    backoffMs: [0],
  });
  return {
    editor,
    draft,
    transport,
    coordinator,
    persistedIntents,
    clearedIntentIds,
    receiptFor,
    setDirty: (generation: number) => {
      dirtyGeneration = generation;
      coordinator.markDirty(generation);
    },
  };
}

type Harness = ReturnType<typeof setup>;

const timeout = { code: "engine_timeout", error_class: "engine", status: 504, retryable: true };

function saveNeverCommits(h: Harness): void {
  h.transport.commit = vi.fn(async () => {
    throw timeout;
  });
  h.transport.reconcile = vi.fn(async () => null);
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
    const h = setup();
    let resolveCommit: (() => void) | undefined;
    h.transport.commit = vi.fn(({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(h.receiptFor(intent));
    }));
    h.setDirty(1);
    const first = h.coordinator.save("button");
    await Promise.resolve();
    await expect(h.coordinator.save("menu")).resolves.toEqual({ accepted: false, reason: "saving" });
    await expect(h.coordinator.save("shortcut")).resolves.toEqual({ accepted: false, reason: "saving" });
    await expect(h.coordinator.save("dialog")).resolves.toEqual({ accepted: false, reason: "saving" });
    expect(h.persistedIntents).toHaveLength(1);
    resolveCommit?.();
    await first;
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
  });

  it("refuses a synchronous double-click before snapshot capture resolves", async () => {
    const h = setup();
    let resolveSnapshot: ((snapshot: StableSnapshot<{ text: string }>) => void) | undefined;
    h.editor.captureSnapshot = vi.fn(() => new Promise<StableSnapshot<{ text: string }>>((resolve) => {
      resolveSnapshot = resolve;
    }));
    h.setDirty(1);
    const first = h.coordinator.save("button");
    await expect(h.coordinator.save("shortcut")).resolves.toEqual({ accepted: false, reason: "saving" });
    resolveSnapshot?.({ generation: 1, fingerprint: "fp-1", value: { text: "draft-1" } });
    await first;
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
  });

  it("keeps N+1 dirty after receipt N and advances the base revision as a string", async () => {
    const h = setup();
    let resolveCommit: (() => void) | undefined;
    h.transport.commit = vi.fn(({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(h.receiptFor(intent));
    }));
    h.setDirty(1);
    const save = h.coordinator.save();
    await vi.waitFor(() => expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1));
    h.setDirty(2);
    resolveCommit?.();
    const result = await save;
    expect(result.accepted).toBe(true);
    expect(h.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 });
    expect(h.coordinator.getState().identity.baseRevision).toBe((BASE_REVISION + 1n).toString());
    expect(vi.mocked(h.draft.discard)).toHaveBeenCalledWith(identity, 1);
  });

  it("discards only the committed draft generation after Save", async () => {
    const h = setup();
    h.setDirty(1);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(true);
    expect(vi.mocked(h.draft.discard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.draft.discard)).toHaveBeenCalledWith(identity, 1);
  });

  it("reconciles a timeout after commit with the same durable intent", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => {
      throw timeout;
    });
    h.transport.reconcile = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(1);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(true);
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.transport.reconcile)).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("retries a timed-out intent with the same key and commits once", async () => {
    const h = setup();
    let attempts = 0;
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
      attempts += 1;
      if (attempts === 1) throw timeout;
      return h.receiptFor(intent);
    });
    h.transport.reconcile = vi.fn(async () => null);
    h.setDirty(1);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(true);
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(2);
    expect(h.persistedIntents).toHaveLength(1);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("keeps an ambiguous pending intent when a newer edit arrives and replays its key", async () => {
    const h = setup();
    let allowCommit = false;
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
      if (!allowCommit) throw timeout;
      return h.receiptFor(intent);
    });
    h.transport.reconcile = vi.fn(async () => null);
    h.setDirty(1);
    const first = await h.coordinator.save();
    expect(first.accepted).toBe(false);
    expect(h.coordinator.getState()).toMatchObject({ state: "error", activeIntentId: h.persistedIntents[0]?.intentId });
    h.setDirty(2);
    expect(h.coordinator.getState().state).toBe("error");
    allowCommit = true;
    const second = await h.coordinator.save("button");
    expect(second.accepted).toBe(true);
    expect(h.persistedIntents).toHaveLength(1);
    expect(h.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 });
  });

  // UNI-953 item 3 (every format: the harness is the generic md fake): edits
  // typed while a save failed with a proven non-commit used to need a second
  // Save after the retry; one Save now saves everything as a new intent.
  it("saves everything typed during a refused save in one new intent, and replays the same bytes otherwise", async () => {
    const h = setup();
    h.transport.release = vi.fn(async () => undefined);
    h.transport.reconcile = vi.fn(async () => null);
    let refuse = true;
    h.transport.serialize = vi.fn(async () => {
      if (refuse) throw { code: "xlsx_rule_sets_dropped", error_class: "engine" };
      return h.transport.serializedOutput;
    });
    h.setDirty(1);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "error" });
    // No newer edit: Retry re-runs the same intent (same key).
    await expect(h.coordinator.save("retry")).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.persistedIntents).toHaveLength(1);
    expect(h.transport.release).not.toHaveBeenCalled();
    // Typed after the failure: ONE Save settles the old intent and saves both.
    h.setDirty(2);
    refuse = false;
    await expect(h.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    expect(h.persistedIntents).toHaveLength(2);
    expect(h.persistedIntents[1]).toMatchObject({ snapshotGeneration: 2 });
    expect(h.persistedIntents[1]?.idempotencyKey).not.toBe(h.persistedIntents[0]?.idempotencyKey);
    expect(h.transport.release).toHaveBeenCalledExactlyOnceWith({ intent: h.persistedIntents[0] });
    expect(h.clearedIntentIds).toContain(h.persistedIntents[0]?.intentId);
    expect(h.coordinator.getState()).toMatchObject({ state: "saved", dirtyGeneration: 2, lastSavedGeneration: 2 });
  });

  // review-session m-2/m-3: a commit that failed with an unmapped (neither
  // ambiguous nor refusal) error may have landed. A later refusal on the retry
  // must not make the intent look settled: it keeps its key and its hold.
  it("keeps a post-commit unsure intent's key after a later refusal and publishes the outcome as unknown", async () => {
    const h = setup();
    h.transport.release = vi.fn(async () => undefined);
    h.transport.reconcile = vi.fn(async () => null);
    let committed = false;
    let open = false;
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => {
      if (open) return h.receiptFor(intent);
      committed = true;
      throw { code: "storage_write_unconfirmed", error_class: "storage", status: 500, retryable: true };
    });
    h.transport.serialize = vi.fn(async () => {
      if (committed && !open) throw { code: "xlsx_rule_sets_dropped", error_class: "engine" };
      return h.transport.serializedOutput;
    });
    h.setDirty(1);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "error" });
    const failed = h.coordinator.getState();
    expect(failed).toMatchObject({ state: "error", activeIntentId: h.persistedIntents[0]?.intentId, outcomeUnknown: true });
    expect(failed.error?.ambiguous).toBe(false);
    h.setDirty(2);
    open = true;
    await expect(h.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    // The same key is replayed, never released for a fresh intent.
    expect(h.persistedIntents).toHaveLength(1);
    expect(h.transport.release).not.toHaveBeenCalled();
    expect(h.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1, outcomeUnknown: false });
  });

  it("reconciles an unresolved intent before a new Save can start", async () => {
    const h = setup();
    saveNeverCommits(h);
    h.setDirty(1);
    await h.coordinator.save();
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(3);
    const reconciled = h.receiptFor(h.persistedIntents[0]!);
    h.transport.reconcile = vi.fn(async () => reconciled);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(true);
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(3);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("keeps the base on a stale conflict, refuses Save in conflict after edits, and stops key reuse with another payload", async () => {
    const conflict = setup();
    conflict.transport.commit = vi.fn(async () => {
      throw { code: "document_version_conflict", error_class: "conflict", status: 409 };
    });
    conflict.setDirty(1);
    await conflict.coordinator.save();
    expect(conflict.coordinator.getState()).toMatchObject({ state: "conflict", identity: { baseRevision: "9007199254740993" } });
    conflict.setDirty(2);
    expect(conflict.coordinator.getState().state).toBe("conflict");
    await expect(conflict.coordinator.save("menu")).resolves.toEqual({ accepted: false, reason: "stale" });
    expect(vi.mocked(conflict.transport.commit)).toHaveBeenCalledTimes(1);
    expect(conflict.clearedIntentIds).toEqual([conflict.persistedIntents[0]?.intentId]);

    const mismatch = setup();
    mismatch.transport.commit = vi.fn(async () => {
      throw { code: "idempotency_payload_mismatch", error_class: "conflict", status: 409 };
    });
    mismatch.setDirty(1);
    await mismatch.coordinator.save();
    expect(mismatch.coordinator.getState().state).toBe("error");
    expect(vi.mocked(mismatch.transport.commit)).toHaveBeenCalledTimes(1);
    await expect(mismatch.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
    expect(vi.mocked(mismatch.transport.commit)).toHaveBeenCalledTimes(1);
  });

  it("releases the transport's per-intent state only when an intent settles without a commit", async () => {
    // Terminal refusal and conflict settle the intent uncommitted: released once each.
    for (const failure of [
      { code: "payload_fingerprint_mismatch", error_class: "conflict", status: 409 },
      { code: "document_version_conflict", error_class: "conflict", status: 409 },
    ]) {
      const h = setup();
      h.transport.release = vi.fn(async () => undefined);
      h.transport.commit = vi.fn(async () => { throw failure; });
      h.setDirty(1);
      await h.coordinator.save();
      expect(h.transport.release).toHaveBeenCalledExactlyOnceWith({ intent: h.persistedIntents[0] });
    }

    // A retryable failure keeps the intent for a retry: no release while it is kept.
    const kept = setup();
    kept.transport.release = vi.fn(async () => undefined);
    saveNeverCommits(kept);
    kept.setDirty(1);
    await kept.coordinator.save();
    expect(kept.coordinator.getState().activeIntentId).toBe(kept.persistedIntents[0]?.intentId);
    expect(kept.transport.release).not.toHaveBeenCalled();

    // A commit is settled "saved": the transport already consumed its state.
    const committed = setup();
    committed.transport.release = vi.fn(async () => undefined);
    committed.setDirty(1);
    await expect(committed.coordinator.save()).resolves.toMatchObject({ accepted: true });
    expect(committed.transport.release).not.toHaveBeenCalled();

    // A throwing release never changes the save outcome.
    const broken = setup();
    broken.transport.release = vi.fn(async () => { throw new Error("release failed"); });
    broken.transport.commit = vi.fn(async () => { throw { code: "payload_fingerprint_mismatch", error_class: "conflict", status: 409 }; });
    broken.setDirty(1);
    await expect(broken.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
  });

  it("saves newer content with a new key after a payload mismatch stopped the old intent", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => {
      throw { code: "payload_fingerprint_mismatch", error_class: "conflict", status: 409 };
    });
    h.setDirty(1);
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState()).toMatchObject({ state: "error", error: { code: "payload_fingerprint_mismatch" } });
    expect(h.clearedIntentIds).toEqual([h.persistedIntents[0]?.intentId]);
    // No new edit: the same bytes are not retried with a fresh key.
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
    // A new edit mints a new intent and key; the stop error stays visible.
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(2);
    expect(h.coordinator.getState().state).toBe("error");
    const saved = await h.coordinator.save("button");
    expect(saved.accepted).toBe(true);
    expect(h.persistedIntents).toHaveLength(2);
    expect(h.persistedIntents[1]?.idempotencyKey).not.toBe(h.persistedIntents[0]?.idempotencyKey);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("never enters saved on a malformed commit receipt without a matching commit", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => ({ documentId: "doc-1", revision: "not-a-revision" }));
    h.transport.reconcile = vi.fn(async () => null);
    h.setDirty(1);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(false);
    expect(h.coordinator.getState().state).toBe("error");
    expect(h.coordinator.getState().activeIntentId).toBeTruthy();
  });

  it("treats a malformed commit receipt as ambiguous and reconciles it", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => ({ documentId: "doc-1", revision: "not-a-revision" }));
    h.transport.reconcile = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(1);
    const result = await h.coordinator.save();
    expect(result.accepted).toBe(true);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("keeps an ambiguous intent across setIdentity and reconciles it before a new key", async () => {
    const h = setup();
    saveNeverCommits(h);
    h.setDirty(1);
    await h.coordinator.save();
    const oldIntent = h.persistedIntents[0]!;
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    expect(h.coordinator.getState()).toMatchObject({
      state: "blocked",
      activeIntentId: oldIntent.intentId,
      error: { code: "pending_intent_recovery" },
    });
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(2);
    const saved = await h.coordinator.save("button");
    expect(saved.accepted).toBe(true);
    expect(vi.mocked(h.transport.reconcile)).toHaveBeenCalledWith(expect.objectContaining({ intent: oldIntent }));
    expect(h.clearedIntentIds).toContain(oldIntent.intentId);
    expect(h.persistedIntents).toHaveLength(2);
    expect(h.persistedIntents[1]?.idempotencyKey).not.toBe(oldIntent.idempotencyKey);
    expect(h.coordinator.getState().state).toBe("saved");
  });

  it("settles a drifted intent that reconcile proves committed without saving again", async () => {
    const h = setup();
    saveNeverCommits(h);
    h.setDirty(1);
    await h.coordinator.save();
    const oldIntent = h.persistedIntents[0]!;
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    h.transport.reconcile = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(2);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState().identity.baseRevision).toBe((BASE_REVISION + 1n).toString());
    expect(h.clearedIntentIds).toContain(oldIntent.intentId);
    expect(h.persistedIntents).toHaveLength(1);
  });

  it("blocks instead of minting a new key when the reconcile question fails", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => {
      throw timeout;
    });
    h.transport.reconcile = vi.fn(async () => {
      throw { code: "storage_unavailable", error_class: "storage", status: 503 };
    });
    h.setDirty(1);
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    h.setDirty(2);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "blocked" });
    expect(h.persistedIntents).toHaveLength(1);
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(3);
  });

  it("settles a receipt that arrives after the generation changed and never replays it", async () => {
    const h = setup();
    let resolveCommit: (() => void) | undefined;
    h.transport.commit = vi.fn(({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(h.receiptFor(intent));
    }));
    h.setDirty(1);
    const first = h.coordinator.save("button");
    await vi.waitFor(() => expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1));
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    resolveCommit?.();
    await expect(first).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState().error?.code).toBe("stale_generation");
    // The server committed, so the document base advances; the session never turns saved.
    expect(h.coordinator.getState().identity.baseRevision).toBe((BASE_REVISION + 1n).toString());
    expect(h.clearedIntentIds).toEqual([h.persistedIntents[0]?.intentId]);
    // No endless replay of the settled key.
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
    // A new edit starts a fresh intent on the advanced base.
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(2);
    const saved = await h.coordinator.save();
    expect(saved.accepted).toBe(true);
    expect(h.persistedIntents).toHaveLength(2);
  });

  it("publishes dirty after an identity change while a newer generation is unsaved", () => {
    const h = setup();
    h.setDirty(1);
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    expect(h.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 1, lastSavedGeneration: 0 });
  });

  it("moves to readonly on a non-available capability and restores once available", async () => {
    const h = setup();
    h.coordinator.setCapability(capability("readonly"));
    expect(h.coordinator.getState()).toMatchObject({ state: "readonly", error: { code: "capability_readonly", action: "read_only" } });
    h.setDirty(1);
    expect(h.coordinator.getState().state).toBe("readonly");
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "readonly" });
    expect(vi.mocked(h.transport.commit)).not.toHaveBeenCalled();
    h.coordinator.setCapability(capability("available"));
    expect(h.coordinator.getState()).toMatchObject({ state: "dirty", error: null });
  });

  it("does not refuse the first edit of a document opened while another document's commit was in flight", async () => {
    const h = setup();
    let resolveCommit: (() => void) | undefined;
    h.transport.commit = vi.fn(({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(h.receiptFor(intent));
    }));
    h.setDirty(1);
    const first = h.coordinator.save("button");
    await vi.waitFor(() => expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1));
    // The session rebinds to another document; its generation counter restarts.
    h.setDirty(0);
    h.coordinator.setIdentity({ ...identity, documentId: "doc-2", baseVersionId: "version-b", generation: 1 });
    resolveCommit?.();
    await expect(first).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState().error?.code).toBe("stale_generation");
    // The new document's first edit at generation 1 must not be refused by the
    // old document's terminal generation.
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(1);
    await expect(h.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    expect(h.persistedIntents).toHaveLength(2);
  });

  it("applies a capability downgrade that arrives while a save is in flight", async () => {
    const h = setup();
    let resolveCommit: (() => void) | undefined;
    h.transport.commit = vi.fn(({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => new Promise((resolve) => {
      resolveCommit = () => resolve(h.receiptFor(intent));
    }));
    h.setDirty(1);
    const first = h.coordinator.save("button");
    await vi.waitFor(() => expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1));
    h.coordinator.setCapability(capability("unavailable"));
    resolveCommit?.();
    await expect(first).resolves.toMatchObject({ accepted: true });
    expect(h.coordinator.getState()).toMatchObject({ state: "readonly", error: { code: "capability_unavailable" } });
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    h.setDirty(2);
    expect(h.coordinator.getState().state).toBe("readonly");
    await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "readonly" });
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(0);
  });

  it("lets Retry re-run a local save after file_locked clears, and keeps the draft after file_changed_on_disk", async () => {
    const h = setup();
    h.transport.commit = vi.fn(async () => {
      throw { code: "file_locked" };
    });
    h.setDirty(1);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_locked", action: "retry" } });
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(3);
    // The user closes the other program and presses Retry on the same bytes.
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    const retried = await h.coordinator.save("button");
    expect(retried.accepted).toBe(true);
    expect(vi.mocked(h.transport.commit)).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getState().state).toBe("saved");

    h.transport.commit = vi.fn(async () => {
      throw { code: "file_changed_on_disk" };
    });
    h.setDirty(2);
    await expect(h.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_changed_on_disk", action: "keep_draft" } });
    // Not terminal: a later Save on the same bytes runs the pending intent again.
    h.transport.commit = vi.fn(async ({ intent }: { intent: OfficeSaveIntent<{ text: string }> }) => h.receiptFor(intent));
    await expect(h.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  });
});
