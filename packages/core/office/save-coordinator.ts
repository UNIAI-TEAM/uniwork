import { z } from "zod";
import { dispatchOfficeError, isOfficeRefusal, type OfficeErrorDispatch, type OfficeState } from "./error-state";
import type { OfficeSaveGuard } from "./save-guard";
import {
  officeIdentitySchema,
  officeSaveIntentSchema,
  officeSaveReceiptSchema,
  officeSerializedOutputSchema,
  officeUploadReceiptSchema,
  type DraftAdapter,
  type EditorHandle,
  type OfficeCapabilityEntry,
  type OfficeCapabilityStatus,
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
  /** Shared with local-file Save so cloud and local entry points cannot race. */
  saveGuard?: OfficeSaveGuard;
}

interface CoordinatorListener {
  (state: SaveCoordinatorState): void;
}

/** The three answers a reconcile can give: the provider holds the commit, it
 *  proved the intent never committed, or the question itself failed. */
type ReconcileAnswer =
  | { status: "found"; receipt: OfficeSaveReceipt }
  | { status: "not_found" }
  | { status: "error"; dispatch: OfficeErrorDispatch };

const DEFAULT_BACKOFF_MS = [250, 1000, 2000] as const;

/** `dirtyGeneration` and `lastSavedGeneration` come from the host editor, so
 *  these are counters, not payloads: they never leave the session. */
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

/** Decimal-string comparison: revisions exceed Number.MAX_SAFE_INTEGER and are
 *  never converted to a JavaScript number (G3 spec §4.4). */
function decimalGreater(left: string, right: string): boolean {
  const a = left.replace(/^0+(?=\d)/, "");
  const b = right.replace(/^0+(?=\d)/, "");
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/** A response outside the seam schema. The code names the step so the error
 *  table can decide between retry and reconcile. */
function pipelineError(code: string): Error {
  const error = new Error(code) as Error & { code: string; error_class: string };
  error.code = code;
  error.error_class = "engine";
  return error;
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
  // A pending intent whose transport hold was already released: a blocked
  // refusal proved it never committed, so a Retry mints a fresh intent.
  let releasedIntentId: string | null = null;
  let terminalGeneration: number | null = null;
  let capabilityStatus: OfficeCapabilityStatus | null = null;
  let capabilityReason: string | null = null;
  const listeners = new Set<CoordinatorListener>();
  const now = options.now ?? (() => Date.now());
  const idFactory = options.idFactory ?? makeId;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let saveGate = false;

  function publish(next: Partial<SaveCoordinatorState>): void {
    state = { ...state, ...next, identity: { ...identity }, dirtyGeneration, lastSavedGeneration };
    for (const listener of listeners) listener(state);
  }

  function sameIdentity(left: OfficeIdentity, right: OfficeIdentity): boolean {
    return sameDocument(left, right) && left.generation === right.generation;
  }

  function sameDocument(left: OfficeIdentity, right: OfficeIdentity): boolean {
    return left.deploymentId === right.deploymentId
      && left.accountId === right.accountId
      && left.organizationId === right.organizationId
      && left.workspaceId === right.workspaceId
      && left.documentId === right.documentId;
  }

  function currentDirty(): boolean {
    return dirtyGeneration > lastSavedGeneration;
  }

  function staleGenerationDispatch(): OfficeErrorDispatch {
    return {
      state: "error",
      code: "stale_generation",
      errorClass: "session",
      correlationId: null,
      retryable: false,
      ambiguous: false,
      action: "keep_draft",
      message: "Office save could not be confirmed",
    };
  }

  function pendingRecoveryDispatch(): OfficeErrorDispatch {
    return {
      state: "blocked",
      code: "pending_intent_recovery",
      errorClass: "session",
      correlationId: null,
      retryable: true,
      ambiguous: true,
      action: "keep_draft",
      message: "Office save outcome is not confirmed yet",
    };
  }

  /** A status other than `available` blocks every Save; unknown is safe and
   *  never grants editing. */
  function capabilityBlocked(): boolean {
    return capabilityStatus !== null && capabilityStatus !== "available";
  }

  function capabilityError(): OfficeErrorDispatch {
    return {
      state: "readonly",
      code: `capability_${capabilityStatus ?? "unknown"}`,
      errorClass: "unknown",
      correlationId: null,
      retryable: false,
      ambiguous: false,
      action: "read_only",
      message: capabilityReason ?? "Office editing is not available for this format",
    };
  }

  function reasonFor(dispatch: OfficeErrorDispatch): SaveAttemptResult {
    if (dispatch.state === "blocked") return { accepted: false, reason: "blocked" };
    if (dispatch.state === "incompatible") return { accepted: false, reason: "incompatible" };
    if (dispatch.state === "conflict") return { accepted: false, reason: "stale" };
    if (dispatch.state === "readonly") return { accepted: false, reason: "readonly" };
    return { accepted: false, reason: "error" };
  }

  function saveError(dispatch: OfficeErrorDispatch): SaveAttemptResult {
    publish({ state: dispatch.state, activeIntentId: pendingIntent?.intentId ?? null, error: dispatch });
    return reasonFor(dispatch);
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
    if (receipt.documentId !== intent.identity.documentId) return null;
    // A receipt that does not advance the base it was built on is not evidence
    // of this commit and must never turn into `saved`.
    if (!decimalGreater(receipt.revision, intent.identity.baseRevision)) return null;
    return receipt;
  }

  async function answerReconcile(intent: OfficeSaveIntent<TSnapshot>): Promise<ReconcileAnswer> {
    try {
      const receipt = parseReceipt(await options.transport.reconcile({ intent }), intent);
      return receipt ? { status: "found", receipt } : { status: "not_found" };
    } catch (error) {
      return { status: "error", dispatch: dispatchOfficeError(error) };
    }
  }

  /** An intent stops being pending only when its outcome is settled: a matching
   *  receipt, a terminal refusal, a reconcile that proved no commit, or a commit
   *  that landed for another document. Terminal outcomes also record their
   *  snapshot generation so a later Save without new content cannot mint a
   *  replacement intent for the same bytes; `released` records nothing because
   *  the generation counters of another document are not comparable.
   *  `release: false` keeps the transport's hold: the bytes may have landed. */
  async function settlePending(intent: OfficeSaveIntent<TSnapshot>, kind: "saved" | "released" | "terminal" | "conflict", release = true): Promise<void> {
    if (pendingIntent?.intentId === intent.intentId) pendingIntent = null;
    const alreadyReleased = releasedIntentId === intent.intentId;
    if (alreadyReleased) releasedIntentId = null;
    if (kind === "saved") terminalGeneration = null;
    else if (kind === "terminal" || kind === "conflict") terminalGeneration = intent.snapshotGeneration;
    const cleanup = [options.draft.clearIntent(intent.intentId).catch(() => undefined)];
    if (kind === "saved") {
      cleanup.push(options.draft.discard(intent.identity, intent.snapshotGeneration).catch(() => undefined));
    } else if (release && !alreadyReleased && options.transport.release) {
      cleanup.push(options.transport.release({ intent }).catch(() => undefined));
    }
    await Promise.all(cleanup);
  }

  /** A blocked refusal (quota, permission, sign-in, a deleted document) proves
   *  the intent never committed but leaves it pending for Retry: the hold on
   *  its prefix ends now, and Retry starts over from the current content. */
  async function releaseBlocked(intent: OfficeSaveIntent<TSnapshot>): Promise<void> {
    if (releasedIntentId === intent.intentId) return;
    releasedIntentId = intent.intentId;
    await options.transport.release?.({ intent }).catch(() => undefined);
  }

  /** `release` is false when the failure may follow a write that landed. */
  async function failIntent(intent: OfficeSaveIntent<TSnapshot>, dispatch: OfficeErrorDispatch, release = true): Promise<SaveAttemptResult> {
    if (dispatch.action === "stop" || dispatch.code === "stale_generation") await settlePending(intent, "terminal", release);
    else if (dispatch.action === "resolve_conflict") await settlePending(intent, "conflict");
    else if (dispatch.state === "blocked" && !dispatch.ambiguous) await releaseBlocked(intent);
    return saveError(dispatch);
  }

  async function complete(intent: OfficeSaveIntent<TSnapshot>, receipt: OfficeSaveReceipt): Promise<SaveAttemptResult> {
    if (sameIdentity(identity, intent.identity)) {
      identity = { ...identity, baseVersionId: receipt.versionId, baseRevision: receipt.revision };
      lastSavedGeneration = Math.max(lastSavedGeneration, intent.snapshotGeneration);
      await settlePending(intent, "saved");
      if (capabilityBlocked()) {
        publish({ state: "readonly", activeIntentId: null, error: capabilityError() });
        return { accepted: true, intentId: intent.intentId, receipt };
      }
      publish({ state: dirtyGeneration > lastSavedGeneration ? "dirty" : "saved", activeIntentId: null, error: null });
      return { accepted: true, intentId: intent.intentId, receipt };
    }
    if (sameDocument(identity, intent.identity)) {
      // The commit is real and belongs to this document; keep the server base
      // even though the session moved on. The state still never turns `saved`.
      identity = { ...identity, baseVersionId: receipt.versionId, baseRevision: receipt.revision };
      return await failIntent(intent, staleGenerationDispatch(), false);
    }
    // Another document's commit: settle it, but never record its generation -
    // the current document's counter has nothing to do with it (G3-01-T1).
    await settlePending(intent, "released");
    return saveError(staleGenerationDispatch());
  }

  async function runIntent(intent: OfficeSaveIntent<TSnapshot>): Promise<SaveAttemptResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // Past this point the provider may hold the bytes even when the step throws.
      let committing = false;
      try {
        const serialized = officeSerializedOutputSchema.safeParse(await options.transport.serialize({
          intent,
          snapshot: { generation: intent.snapshotGeneration, fingerprint: intent.snapshotFingerprint, value: intent.snapshot },
        }));
        if (!serialized.success) throw pipelineError("malformed_serialized_output");
        const uploaded = officeUploadReceiptSchema.safeParse(await options.transport.upload({ intent, output: serialized.data }));
        if (!uploaded.success) throw pipelineError("malformed_upload_receipt");
        committing = true;
        const receipt = parseReceipt(await options.transport.commit({ intent, upload: uploaded.data }), intent);
        if (!receipt) throw pipelineError("malformed_commit_receipt");
        return await complete(intent, receipt);
      } catch (error) {
        const dispatch = dispatchOfficeError(error);
        if (dispatch.ambiguous) {
          const answer = await answerReconcile(intent);
          if (answer.status === "found") return await complete(intent, answer.receipt);
        }
        if (!dispatch.retryable || attempt + 1 >= maxAttempts) return await failIntent(intent, dispatch, !committing || isOfficeRefusal(dispatch));
        publish({ state: "saving", activeIntentId: intent.intentId, error: dispatch });
        await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0);
      }
    }
    return saveError(dispatchOfficeError(new Error("office_retry_exhausted")));
  }

  async function startIntent(intent: OfficeSaveIntent<TSnapshot>): Promise<SaveAttemptResult> {
    pendingIntent = intent;
    terminalGeneration = null;
    publish({ state: "saving", activeIntentId: intent.intentId, error: null });
    try {
      await options.draft.persistIntent(intent);
    } catch (error) {
      return await failIntent(intent, dispatchOfficeError(error));
    }
    return await runIntent(intent);
  }

  async function startNewIntent(snapshot: StableSnapshot<TSnapshot>): Promise<SaveAttemptResult> {
    if (!currentDirty()) return { accepted: false, reason: "clean" };
    // After a terminal refusal the same bytes are not retried with a fresh
    // key: the error row allows a new intent only after a new edit.
    if (terminalGeneration !== null && snapshot.generation <= terminalGeneration) return { accepted: false, reason: "error" };
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
    return await startIntent(intent);
  }

  /** An unresolved intent is never orphaned and never replayed into another
   *  session: it is reconciled under its own identity first. */
  async function recoverPendingSave(snapshot: StableSnapshot<TSnapshot>): Promise<SaveAttemptResult> {
    const intent = pendingIntent;
    if (!intent) return { accepted: false, reason: "clean" };
    if (releasedIntentId === intent.intentId) {
      await settlePending(intent, "released");
      return await startNewIntent(snapshot);
    }
    const answer = await answerReconcile(intent);
    if (answer.status === "found") return await complete(intent, answer.receipt);
    if (answer.status === "error") {
      return saveError({
        state: "blocked",
        code: "reconcile_unavailable",
        errorClass: "storage",
        correlationId: answer.dispatch.correlationId,
        retryable: true,
        ambiguous: true,
        action: "keep_draft",
        message: "Office save outcome is not confirmed yet",
      });
    }
    if (sameIdentity(intent.identity, identity)) {
      return await runIntent(intent);
    }
    // The session moved on while the outcome was unknown and the reconcile
    // proved the old intent never committed. Settle it, then let the current
    // session start its own intent.
    await settlePending(intent, "released");
    return await startNewIntent(snapshot);
  }

  async function save(_entryPoint: OfficeSaveEntryPoint = "button"): Promise<SaveAttemptResult> {
    if (saveGate) return { accepted: false, reason: "saving" };
    if (state.state === "saving") return { accepted: false, reason: "saving" };
    if (state.state === "readonly") return { accepted: false, reason: "readonly" };
    if (state.state === "incompatible") return { accepted: false, reason: "incompatible" };
    // A capability that dropped while an earlier save was in flight is applied
    // here even if the settle already published another state (G3-01-T2).
    if (capabilityBlocked()) {
      publish({ state: "readonly", error: capabilityError() });
      return { accepted: false, reason: "readonly" };
    }

    const releaseExternal = options.saveGuard?.tryAcquire();
    if (options.saveGuard && !releaseExternal) return { accepted: false, reason: "saving" };

    saveGate = true;
    try {
      const snapshot = parseSnapshot(await options.editor.captureSnapshot());
      if (!snapshot || snapshot.generation !== dirtyGeneration) return { accepted: false, reason: "invalid_snapshot" };
      if (pendingIntent) return await recoverPendingSave(snapshot);
      if (state.state === "blocked") return { accepted: false, reason: "blocked" };
      // `conflict` is explicit-only until a resolve API exists (handoff §7 has
      // none): every Save entry point refuses it, whatever the dirty state.
      if (state.state === "conflict") return { accepted: false, reason: "stale" };
      return await startNewIntent(snapshot);
    } finally {
      saveGate = false;
      releaseExternal?.();
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
      const sticky = state.state === "saving" || state.state === "blocked" || state.state === "readonly"
        || state.state === "incompatible" || state.state === "conflict" || state.state === "error";
      if (sticky) publish({ dirtyGeneration });
      else publish({ state: "dirty", error: null });
    },
    setIdentity: (next: OfficeIdentity): void => {
      const parsed = officeIdentitySchema.parse(next);
      const documentChanged = !sameDocument(identity, parsed);
      identity = parsed;
      if (documentChanged) {
        dirtyGeneration = options.editor.getDirtyGeneration();
        lastSavedGeneration = dirtyGeneration;
        terminalGeneration = null;
      }
      if (pendingIntent) {
        if (sameIdentity(pendingIntent.identity, identity)) {
          publish({ identity });
          return;
        }
        // Keep the unresolved intent and its error: a new session must not
        // mint an intent while an older outcome is still unknown.
        publish({ identity, state: "blocked", error: pendingRecoveryDispatch() });
        return;
      }
      if (capabilityBlocked()) {
        publish({ identity, state: "readonly" });
        return;
      }
      publish({ identity, state: currentDirty() ? "dirty" : "ready", error: null });
    },
    setCapability: (entry: OfficeCapabilityEntry): void => {
      capabilityStatus = entry.status;
      capabilityReason = entry.reason ?? null;
      // A save in flight owns the state until it settles; `complete()` (or the
      // next `save()`) re-applies a non-available status, so the downgrade is
      // never dropped (G3-01-T2).
      if (state.state === "saving") return;
      if (entry.status === "available") {
        if (state.state === "readonly") publish({ state: currentDirty() ? "dirty" : "ready", error: null });
        return;
      }
      publish({ state: "readonly", error: capabilityError() });
    },
    save,
    retry: (): Promise<SaveAttemptResult> => save("retry"),
    checkpoint: async (): Promise<void> => {
      const snapshot = parseSnapshot(await options.editor.captureSnapshot());
      if (snapshot) await options.draft.checkpoint(snapshot);
    },
    reconcile: async (): Promise<OfficeSaveReceipt | null> => {
      const intent = pendingIntent;
      if (!intent) return null;
      const answer = await answerReconcile(intent);
      if (answer.status !== "found") return null;
      const result = await complete(intent, answer.receipt);
      return result.accepted ? answer.receipt : null;
    },
    cancel: async (): Promise<void> => {
      if (pendingIntent && options.transport.cancel) await options.transport.cancel({ intent: pendingIntent });
    },
  };
}
