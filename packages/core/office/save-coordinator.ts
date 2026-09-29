import { z } from "zod";
import { dispatchOfficeError, type OfficeErrorDispatch, type OfficeState } from "./error-state";
import {
  officeIdentitySchema,
  officeSaveIntentSchema,
  officeSaveReceiptSchema,
  officeSerializedOutputSchema,
  officeUploadReceiptSchema,
  type DraftAdapter,
  type EditorHandle,
  type OfficeIdentity,
  type OfficeSaveIntent,
  type OfficeSaveReceipt,
  type OfficeSaveTransport,
  type StableSnapshot,
} from "./host-contract";

export type OfficeSaveEntryPoint = "button" | "menu" | "shortcut" | "dialog" | "retry";

export interface SaveCoordinatorState {
  state: OfficeState;
  identity: OfficeIdentity;
  dirtyGeneration: number;
  lastSavedGeneration: number;
  activeIntentId: string | null;
  error: OfficeErrorDispatch | null;
}

export type SaveAttemptResult =
  | { accepted: true; intentId: string; receipt: OfficeSaveReceipt }
  | { accepted: false; reason: "clean" | "saving" | "blocked" | "readonly" | "incompatible" | "stale" | "error" | "invalid_snapshot" };

export interface SaveCoordinatorOptions<TSnapshot> {
  identity: OfficeIdentity;
  editor: EditorHandle<TSnapshot>;
  draft: DraftAdapter<TSnapshot>;
  transport: OfficeSaveTransport<TSnapshot>;
  now?: () => number;
  idFactory?: (prefix: string) => string;
  maxAttempts?: number;
  backoffMs?: readonly number[];
}

interface CoordinatorListener {
  (state: SaveCoordinatorState): void;
}

const DEFAULT_BACKOFF_MS = [250, 1000, 2000] as const;

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function parseSnapshot<TSnapshot>(snapshot: StableSnapshot<TSnapshot>): StableSnapshot<TSnapshot> | null {
  const result = z.object({
    generation: z.number().int().nonnegative(),
    fingerprint: z.string().min(1),
    value: z.unknown(),
    checksumSha256: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  }).safeParse(snapshot);
  return result.success ? (result.data as StableSnapshot<TSnapshot>) : null;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createOfficeSaveCoordinator<TSnapshot>(options: SaveCoordinatorOptions<TSnapshot>) {
  let identity = officeIdentitySchema.parse(options.identity);
  let dirtyGeneration = options.editor.getDirtyGeneration();
  let lastSavedGeneration = dirtyGeneration;
  let state: SaveCoordinatorState = {
    state: "ready",
    identity,
    dirtyGeneration,
    lastSavedGeneration,
    activeIntentId: null,
    error: null,
  };
  let pendingIntent: OfficeSaveIntent<TSnapshot> | null = null;
  let inFlight: Promise<SaveAttemptResult> | null = null;
  const listeners = new Set<CoordinatorListener>();
  const now = options.now ?? (() => Date.now());
  const idFactory = options.idFactory ?? makeId;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  function publish(next: Partial<SaveCoordinatorState>): void {
    state = { ...state, ...next, identity: { ...identity }, dirtyGeneration, lastSavedGeneration };
    for (const listener of listeners) listener(state);
  }

  function sameIdentity(left: OfficeIdentity, right: OfficeIdentity): boolean {
    return left.deploymentId === right.deploymentId
      && left.accountId === right.accountId
      && left.organizationId === right.organizationId
      && left.workspaceId === right.workspaceId
      && left.documentId === right.documentId
      && left.generation === right.generation;
  }

  function currentDirty(): boolean {
    return dirtyGeneration > lastSavedGeneration;
  }

  function saveError(dispatch: OfficeErrorDispatch): SaveAttemptResult {
    publish({ state: dispatch.state, activeIntentId: pendingIntent?.intentId ?? null, error: dispatch });
    if (dispatch.state === "blocked") return { accepted: false, reason: "blocked" };
    if (dispatch.state === "incompatible") return { accepted: false, reason: "incompatible" };
    if (dispatch.state === "conflict") return { accepted: false, reason: "stale" };
    return { accepted: false, reason: "error" };
  }

  function parseIntent(raw: unknown): OfficeSaveIntent<TSnapshot> | null {
    const result = officeSaveIntentSchema.safeParse(raw);
    return result.success ? (result.data as OfficeSaveIntent<TSnapshot>) : null;
  }

  function parseReceipt(raw: unknown, intent: OfficeSaveIntent<TSnapshot>): OfficeSaveReceipt | null {
    const result = officeSaveReceiptSchema.safeParse(raw);
    if (!result.success) return null;
    const receipt = result.data;
    if (receipt.intentId !== intent.intentId || receipt.idempotencyKey !== intent.idempotencyKey) return null;
    if (receipt.documentId !== intent.identity.documentId || receipt.revision.length === 0) return null;
    return receipt;
  }

  async function reconcile(intent: OfficeSaveIntent<TSnapshot>): Promise<OfficeSaveReceipt | null> {
    const raw = await options.transport.reconcile({ intent });
    return parseReceipt(raw, intent);
  }

  function complete(intent: OfficeSaveIntent<TSnapshot>, receipt: OfficeSaveReceipt): SaveAttemptResult {
    if (!sameIdentity(identity, intent.identity)) {
      return saveError({
        state: "error",
        code: "stale_generation",
        errorClass: "session",
        correlationId: null,
        retryable: false,
        ambiguous: false,
        action: "keep_draft",
        message: "Office save could not be confirmed",
      });
    }
    identity = { ...identity, baseVersionId: receipt.versionId, baseRevision: receipt.revision };
    lastSavedGeneration = intent.snapshotGeneration;
    pendingIntent = null;
    void options.draft.clearIntent(intent.intentId);
    publish({ state: dirtyGeneration > lastSavedGeneration ? "dirty" : "saved", activeIntentId: null, error: null });
    return { accepted: true, intentId: intent.intentId, receipt };
  }

  async function runIntent(intent: OfficeSaveIntent<TSnapshot>): Promise<SaveAttemptResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const serialized = officeSerializedOutputSchema.safeParse(await options.transport.serialize({
          intent,
          snapshot: { generation: intent.snapshotGeneration, fingerprint: intent.snapshotFingerprint, value: intent.snapshot },
        }));
        if (!serialized.success) throw new Error("malformed_serialized_output");
        const uploaded = officeUploadReceiptSchema.safeParse(await options.transport.upload({ intent, output: serialized.data }));
        if (!uploaded.success) throw new Error("malformed_upload_receipt");
        const committedRaw = await options.transport.commit({ intent, upload: uploaded.data });
        const receipt = parseReceipt(committedRaw, intent);
        if (!receipt) throw new Error("malformed_commit_receipt");
        return complete(intent, receipt);
      } catch (error) {
        const dispatch = dispatchOfficeError(error);
        if (dispatch.ambiguous) {
          try {
            const reconciled = await reconcile(intent);
            if (reconciled) return complete(intent, reconciled);
          } catch {
            // The intent remains durable and will be reconciled by the next explicit retry.
          }
        }
        if (!dispatch.retryable || attempt + 1 >= maxAttempts || dispatch.code.includes("payload") || dispatch.code.includes("key_reuse")) {
          return saveError(dispatch);
        }
        publish({ state: "saving", activeIntentId: intent.intentId, error: dispatch });
        await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0);
      }
    }
    return saveError(dispatchOfficeError(new Error("office_retry_exhausted")));
  }

  async function startIntent(intent: OfficeSaveIntent<TSnapshot>): Promise<SaveAttemptResult> {
    pendingIntent = intent;
    publish({ state: "saving", activeIntentId: intent.intentId, error: null });
    try {
      await options.draft.persistIntent(intent);
    } catch (error) {
      return saveError(dispatchOfficeError(error));
    }
    return runIntent(intent);
  }

  async function save(_entryPoint: OfficeSaveEntryPoint = "button"): Promise<SaveAttemptResult> {
    if (inFlight) return { accepted: false, reason: "saving" };
    if (state.state === "saving") return { accepted: false, reason: "saving" };
    if (state.state === "blocked") return { accepted: false, reason: "blocked" };
    if (state.state === "readonly") return { accepted: false, reason: "readonly" };
    if (state.state === "incompatible") return { accepted: false, reason: "incompatible" };
    if (!currentDirty()) return { accepted: false, reason: "clean" };

    const snapshot = parseSnapshot(await options.editor.captureSnapshot());
    if (!snapshot || snapshot.generation !== dirtyGeneration) return { accepted: false, reason: "invalid_snapshot" };
    if (pendingIntent && pendingIntent.snapshotFingerprint === snapshot.fingerprint && state.error) {
      const retry = startIntent(pendingIntent);
      inFlight = retry;
      try {
        return await retry;
      } finally {
        if (inFlight === retry) inFlight = null;
      }
    }
    const intent = parseIntent({
      intentId: idFactory("office-intent"),
      idempotencyKey: idFactory("office-key"),
      identity,
      snapshotGeneration: snapshot.generation,
      snapshotFingerprint: snapshot.fingerprint,
      snapshot: snapshot.value,
      operation: "manual_save",
      createdAt: now(),
    });
    if (!intent) return { accepted: false, reason: "invalid_snapshot" };
    const request = startIntent(intent);
    inFlight = request;
    try {
      return await request;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }

  return {
    getState: (): SaveCoordinatorState => ({ ...state, identity: { ...identity } }),
    subscribe: (listener: CoordinatorListener): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markDirty: (generation: number): void => {
      if (!Number.isSafeInteger(generation) || generation < 0) return;
      dirtyGeneration = Math.max(dirtyGeneration, generation);
      if (state.state !== "saving" && state.state !== "blocked" && state.state !== "readonly" && state.state !== "incompatible") {
        publish({ state: "dirty", error: null });
      } else {
        publish({ dirtyGeneration });
      }
    },
    setIdentity: (next: OfficeIdentity): void => {
      identity = officeIdentitySchema.parse(next);
      publish({ identity, state: state.state === "saving" ? "saving" : "ready", error: null });
    },
    save,
    retry: (): Promise<SaveAttemptResult> => save("retry"),
    checkpoint: async (): Promise<void> => {
      const snapshot = parseSnapshot(await options.editor.captureSnapshot());
      if (snapshot) await options.draft.checkpoint(snapshot);
    },
    reconcile: async (): Promise<OfficeSaveReceipt | null> => (pendingIntent ? reconcile(pendingIntent) : null),
    cancel: async (): Promise<void> => {
      if (pendingIntent && options.transport.cancel) await options.transport.cancel({ intent: pendingIntent });
    },
  };
}
