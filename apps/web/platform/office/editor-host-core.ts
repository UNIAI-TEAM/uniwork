"use client";

import type {
  DraftAdapter,
  DraftBase,
  DraftIdentity,
  DraftMetadata,
  DraftRecoveryError,
  DraftSession,
  EditorHandle,
  OfficeIdentity,
  OfficeSaveIntent,
  OfficeSaveTransport,
  SaveSettleGate,
  StableSnapshot,
} from "@uniwork/core/office";
import { createSaveSettleGate, DraftRecoveryError as DraftRecoveryErrorClass } from "@uniwork/core/office";
import { registerOfficeDraftMemoryCleanup } from "@uniwork/core/drafts/cleanup-registry";
import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import { createDraftKeyProvider, type DraftKeyProvider } from "./draft-key-provider";
import { createDraftStore, type IndexedDbDraftStore } from "./draft-store";

export interface BrowserOfficeDraftOptions<TSnapshot> {
  identity: OfficeIdentity;
  session: DraftSession;
  draftStore?: IndexedDbDraftStore;
  keyProvider?: DraftKeyProvider;
  /** The draft id is stable per document; it is not used as an auth scope. */
  draftId?: string;
  liveAccess?: "edit" | "none";
  /** How long a checkpoint waits for a Save in flight before it writes under
   *  the pre-rebase base (default 10 s). */
  saveSettleMaxWaitMs?: number;
}

export interface BrowserOfficeDraftAdapter<TSnapshot> extends DraftAdapter<TSnapshot> {
  checkpointDurable(snapshot: StableSnapshot<TSnapshot>): Promise<void>;
  rebaseDurable(identity: OfficeIdentity, snapshot: StableSnapshot<TSnapshot>, savedGeneration: number): Promise<void>;
  recoverDurable(): Promise<StableSnapshot<TSnapshot> | null>;
  discardDurable(generation?: number): Promise<boolean>;
  clearMemory(): Promise<void>;
  dispose(): Promise<void>;
  readonly draftStore: IndexedDbDraftStore;
  readonly keyProvider: DraftKeyProvider;
}

export interface OfficeEditorSession<TSnapshot> {
  editor: EditorHandle<TSnapshot>;
  coordinator: ReturnType<typeof createOfficeSaveCoordinator<TSnapshot>>;
  draft: BrowserOfficeDraftAdapter<TSnapshot>;
  checkpoint(): Promise<boolean>;
  recoverDraft(): Promise<OfficeRecoveryState<TSnapshot>>;
  discardDraft(): Promise<boolean>;
  clearMemory(): Promise<void>;
  dispose(): Promise<void>;
}

export type OfficeRecoveryState<TSnapshot> =
  | { status: "missing" }
  | { status: "recovered"; snapshot: StableSnapshot<TSnapshot>; metadata: DraftMetadata }
  | { status: "conflict"; metadata: DraftMetadata; currentBase: DraftBase; draftBase: DraftBase }
  | { status: "blocked"; metadata?: DraftMetadata }
  | { status: "locked"; metadata?: DraftMetadata };

function toDraftIdentity(identity: OfficeIdentity): DraftIdentity {
  return {
    deploymentId: identity.deploymentId,
    accountId: identity.accountId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    documentId: identity.documentId,
    base: { revision: identity.baseRevision, version: identity.baseVersionId },
  };
}

function toDraftSession(session: DraftSession): DraftSession {
  return { ...session };
}

function encodeSnapshot<TSnapshot>(snapshot: StableSnapshot<TSnapshot>): Uint8Array {
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot));
  } catch {
    throw new DraftRecoveryErrorClass("invalid_snapshot", "office snapshot is not serializable");
  }
}

function decodeSnapshot<TSnapshot>(bytes: Uint8Array): StableSnapshot<TSnapshot> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") throw new Error("snapshot is not an object");
    const value = parsed as Partial<StableSnapshot<TSnapshot>>;
    const generation = value.generation;
    if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0 || typeof value.fingerprint !== "string" || !value.fingerprint) {
      throw new Error("snapshot metadata is invalid");
    }
    return {
      generation,
      fingerprint: value.fingerprint,
      value: value.value as TSnapshot,
      ...(typeof value.checksumSha256 === "string" ? { checksumSha256: value.checksumSha256 } : {}),
      ...(Number.isSafeInteger(value.sizeBytes) ? { sizeBytes: value.sizeBytes } : {}),
    };
  } catch {
    throw new DraftRecoveryErrorClass("draft_recovery_locked", "office draft could not be decoded");
  }
}

/**
 * Bridges the coordinator's host-neutral DraftAdapter to the protected
 * IndexedDB/key-provider pair. Plain snapshots are encoded only for the
 * duration of the WebCrypto call; durable records contain ciphertext and the
 * wrapped per-draft key, never a plaintext fallback.
 */
export function createBrowserOfficeDraftAdapter<TSnapshot>(
  options: BrowserOfficeDraftOptions<TSnapshot>,
): BrowserOfficeDraftAdapter<TSnapshot> {
  const draftStore = options.draftStore ?? createDraftStore();
  const keyProvider = options.keyProvider ?? createDraftKeyProvider({});
  const session = toDraftSession(options.session);
  let identity = toDraftIdentity(options.identity);
  const draftId = options.draftId ?? options.identity.documentId;
  const liveAccess = options.liveAccess ?? "edit";
  const intents = new Map<string, OfficeSaveIntent<TSnapshot>>();
  // Checkpoints and Save cleanup share one serialized lane. A checkpoint can
  // be in flight when Save settles (the host checkpoint timer is independent
  // of the coordinator); without ordering, the late checkpoint can recreate
  // the draft that Save just deleted and show recovery again after reload.
  let draftOperationTail: Promise<void> = Promise.resolve();
  // The highest generation the coordinator has confirmed committed. A
  // checkpoint at or below this watermark is content the Save already owns:
  // writing it back would resurrect the durable record the Save deleted and
  // resurface as a stale "Draft found" offer on the next open (F-6).
  let savedGeneration = 0;
  const enqueueDraftOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = draftOperationTail.then(operation);
    draftOperationTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const lookupScope = (() => {
    const { base: _base, ...scope } = identity;
    return scope;
  })();

  const checkpointDurable = (snapshot: StableSnapshot<TSnapshot>) => enqueueDraftOperation(async () => {
    if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) {
      throw new DraftRecoveryErrorClass("invalid_snapshot", "draft generation must be positive");
    }
    // A Save that settled while this checkpoint was queued already committed
    // this generation; the durable draft no longer exists and must not be
    // recreated (the host timer is independent of the coordinator).
    if (snapshot.generation <= savedGeneration) return;
    const encrypted = await keyProvider.encrypt({ identity, draftId, generation: snapshot.generation, plaintext: encodeSnapshot(snapshot) });
    await draftStore.checkpointEncrypted({
      session,
      wrappedKey: encrypted.wrappedKey,
      snapshot: {
        draftId,
        identity,
        generation: snapshot.generation,
        checksum: encrypted.checksum,
        ciphertext: encrypted.ciphertext,
      },
    });
  });

  const recoverDurable = async (): Promise<StableSnapshot<TSnapshot> | null> => {
    // Omit the base from lookup so the adapter can classify an older draft as
    // a conflict instead of making it look like there is no draft.
    const result = await draftStore.recoverEncrypted({ session, lookup: { ...lookupScope, draftId }, currentBase: identity.base, liveAccess });
    if (result.status === "missing") return null;
    if (result.status !== "recovered") throw new DraftRecoveryErrorClass(result.status === "blocked" ? "forbidden" : "draft_recovery_locked", "draft recovery did not produce plaintext");
    if (!("wrappedKey" in result)) throw new DraftRecoveryErrorClass("draft_recovery_locked", "draft key envelope is unavailable");
    const decrypted = await keyProvider.decrypt({
      session,
      identity: result.metadata.identity,
      draftId: result.metadata.draftId,
      generation: result.metadata.generation,
      checksum: result.metadata.checksum,
      ciphertext: result.ciphertext,
      wrappedKey: result.wrappedKey,
      liveAccess,
    });
    return decodeSnapshot<TSnapshot>(decrypted);
  };

  const discardDurable = (generation?: number): Promise<boolean> => enqueueDraftOperation(async () => {
    // Keep the base out of the lookup so a changed-base draft can still be
    // explicitly discarded from the recovery conflict prompt.
    const records = await draftStore.list({ session, lookup: { ...lookupScope, draftId } });
    if (generation === undefined) {
      const newest = [...records].sort((left, right) => right.generation - left.generation)[0];
      if (!newest) return true;
      await draftStore.deleteDurable({ session, draftId: newest.draftId, generation: newest.generation });
      return true;
    }
    // A confirmed Save consumes every checkpoint at or below the snapshot it
    // committed, whatever base each one carries. Deleting only an exact
    // generation match left older checkpoints behind, and those outlived the
    // Save as a stale draft (F-6). A checkpoint newer than the commit is
    // genuinely unsaved and stays for recovery.
    savedGeneration = Math.max(savedGeneration, generation);
    const consumed = records.filter((record) => record.generation <= generation);
    if (consumed.length === 0) return true;
    await Promise.all(consumed.map((record) => draftStore.deleteDurable({ session, draftId: record.draftId, generation: record.generation })));
    return true;
  });

  const clearMemory = async () => {
    intents.clear();
    await Promise.all([Promise.resolve(draftStore.clearMemory()), keyProvider.clearMemory()]);
  };
  const unregister = registerOfficeDraftMemoryCleanup(() => { void clearMemory(); });

  const adapter: BrowserOfficeDraftAdapter<TSnapshot> = {
    draftStore,
    keyProvider,
    checkpoint: checkpointDurable,
    checkpointDurable,
    rebaseDurable: (next, snapshot, savedGeneration) => enqueueDraftOperation(async () => {
      const nextIdentity = toDraftIdentity(next);
      if (identity.base.revision === nextIdentity.base.revision && identity.base.version === nextIdentity.base.version) return;
      if (snapshot.generation > savedGeneration) {
        const encrypted = await keyProvider.encrypt({ identity: nextIdentity, draftId, generation: snapshot.generation, plaintext: encodeSnapshot(snapshot) });
        await draftStore.rebaseEncrypted({
          session, wrappedKey: encrypted.wrappedKey,
          snapshot: { draftId, identity: nextIdentity, generation: snapshot.generation, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext },
        }, identity);
      }
      identity = nextIdentity;
    }),
    recover: async () => recoverDurable(),
    recoverDurable,
    discard: async (_identity, generation) => { await discardDurable(generation); },
    discardDurable,
    persistIntent: async (intent) => { intents.set(intent.intentId, intent); },
    loadIntent: async (current) => [...intents.values()].find((intent) => intent.identity.documentId === current.documentId) ?? null,
    clearIntent: async (intentId) => { intents.delete(intentId); },
    clearMemory,
    dispose: async () => { unregister(); await clearMemory(); },
  };
  return adapter;
}

export interface OfficeEditorSessionOptions<TSnapshot> extends BrowserOfficeDraftOptions<TSnapshot> {
  editor: EditorHandle<TSnapshot>;
  transport: OfficeSaveTransport<TSnapshot>;
  /** The adapter's gate, when its transport rebases the editor before commit
   *  returns and marks that rebase itself. */
  gate?: SaveSettleGate;
}

export function createOfficeEditorSession<TSnapshot>(options: OfficeEditorSessionOptions<TSnapshot>): OfficeEditorSession<TSnapshot> {
  const draft = createBrowserOfficeDraftAdapter<TSnapshot>(options);
  // A Save rebases the editor (pptx/xlsx journals, inside commit or reconcile)
  // and then the draft identity; a checkpoint captured across that window would
  // land a pre-rebase snapshot under the new base. Saves run inside the gate,
  // and a returned commit or reconcile marks the rebase window, which lasts
  // until the Save settles. An adapter whose runtime rebases inside commit
  // (pptx, xlsx) passes its gate and marks before that rebase. A Save that never answers holds checkpoints back
  // only for the gate's bound; they then write under the pre-rebase base.
  const gate = options.gate ?? createSaveSettleGate({ maxWaitMs: options.saveSettleMaxWaitMs });
  // Every other step delegates to the caller's transport as it is at call time.
  const transport: OfficeSaveTransport<TSnapshot> = Object.assign(Object.create(options.transport) as OfficeSaveTransport<TSnapshot>, {
    commit: async (input: Parameters<OfficeSaveTransport<TSnapshot>["commit"]>[0]) => {
      const receipt = await options.transport.commit(input);
      gate.markRebase();
      return receipt;
    },
    reconcile: async (input: Parameters<OfficeSaveTransport<TSnapshot>["reconcile"]>[0]) => {
      const answer = await options.transport.reconcile(input);
      gate.markRebase();
      return answer;
    },
  });
  const coordinator = createOfficeSaveCoordinator({ identity: options.identity, editor: options.editor, draft, transport });
  let disposed = false;
  const identity = toDraftIdentity(options.identity);
  const { base: _base, ...lookupScope } = identity;
  const rebaseDraft = async () => {
    const state = coordinator.getState();
    const snapshot = await options.editor.captureSnapshot();
    await draft.rebaseDurable(state.identity, snapshot, state.lastSavedGeneration);
  };
  // A commit first rebases the editor's save source (DOCX core properties),
  // then the draft; both inside the gate.
  const save: typeof coordinator.save = (entryPoint) => gate.run(async () => {
    const result = await coordinator.save(entryPoint);
    if (result.accepted) {
      await options.editor.rebaseSaveSource?.(result.receipt);
      await rebaseDraft();
    }
    return result;
  });
  // `checkpointDurable` enqueues on the draft lane synchronously, so the
  // write is ordered before any later Save's rebase of the draft identity. A
  // capture parked behind a held Save resumes after dispose; it writes nothing.
  const checkpointSettled = (markDirty: boolean) => gate.capture(
    () => options.editor.captureSnapshot(),
    (snapshot) => {
      if (disposed) throw new Error("office_editor_disposed");
      if (markDirty) coordinator.markDirty(snapshot.generation);
      return draft.checkpointDurable(snapshot);
    },
  );
  const sessionCoordinator = {
    ...coordinator,
    save,
    retry: () => save("retry"),
    checkpoint: () => checkpointSettled(false),
    reconcile: () => gate.run(async () => {
      const receipt = await coordinator.reconcile();
      if (receipt) {
        await options.editor.rebaseSaveSource?.(receipt);
        await rebaseDraft();
      }
      return receipt;
    }),
  };
  return {
    editor: options.editor,
    coordinator: sessionCoordinator,
    draft,
    async checkpoint() {
      await checkpointSettled(true);
      return true;
    },
    async recoverDraft() {
      try {
        const result = await draft.draftStore.recoverEncrypted({
          session: options.session,
          lookup: { ...lookupScope, draftId: options.draftId ?? options.identity.documentId },
          currentBase: toDraftIdentity(coordinator.getState().identity).base,
          liveAccess: options.liveAccess ?? "edit",
        });
        if (result.status === "missing") return { status: "missing" as const };
        if (result.status === "conflict") return { status: "conflict" as const, metadata: result.metadata, currentBase: result.currentBase, draftBase: result.draftBase };
        if (result.status === "blocked") return { status: "blocked" as const, metadata: result.metadata };
        if (result.status === "locked") return { status: "locked" as const, metadata: result.metadata };
        if (result.status === "ambiguous") return { status: "locked" as const };
        if (!("wrappedKey" in result)) return { status: "locked" as const, metadata: result.metadata };
        const plaintext = await draft.keyProvider.decrypt({
          session: options.session,
          identity: result.metadata.identity,
          draftId: result.metadata.draftId,
          generation: result.metadata.generation,
          checksum: result.metadata.checksum,
          ciphertext: result.ciphertext,
          wrappedKey: result.wrappedKey,
          liveAccess: options.liveAccess ?? "edit",
        });
        return { status: "recovered" as const, snapshot: decodeSnapshot<TSnapshot>(plaintext), metadata: result.metadata };
      } catch (error) {
        const cause = error as DraftRecoveryError;
        if (cause?.code === "forbidden") return { status: "blocked" as const };
        return { status: "locked" as const };
      }
    },
    discardDraft: () => draft.discardDurable(),
    clearMemory: draft.clearMemory,
    dispose: async () => { disposed = true; await draft.dispose(); await Promise.resolve(options.editor.dispose()); },
  };
}
