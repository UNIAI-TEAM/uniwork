import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import { createSaveSettleGate } from "@uniwork/core/office";
import type { DraftAdapter, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot, SaveAttemptResult } from "@uniwork/core/office";
import type { DesktopEditorSurface, DesktopSurfaceSettings } from "./surface";
import { desktopSurfaceFactory } from "./surface-registry";
import { desktopEngineBuild, type DesktopDocumentFormat } from "../../shared/document-formats";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, desktopDraftRecoveryResponseSchema, desktopDraftResponseSchema, desktopFileResponseSchema, desktopOfficeOpenResponseSchema, desktopOfficeSaveResponseSchema, type DesktopDraftMetadata } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";
import { throwIfLocalFileFailed } from "./local-file-failure";
import type { DesktopTextFacets } from "./text-surface";
import type { PdfCanvasPage, PdfEditOperation, PdfFormField, PdfNoteThread, PdfPageRenderService, PdfSearchHit, PdfSnapshot } from "@uniwork/views/office/pdf";

export type OpenedBytes = { format: DesktopDocumentFormat; data: Uint8Array; checksum: string; localHandle?: string; localUntitled?: boolean; canSave?: boolean };

import { bytesToText, incomingBytes, textToBytes } from "./bytes";

const SESSION_GENERATION = "desktop-dev-session";



export type DraftRecoveryView =
  | { readonly status: "none" }
  | { readonly status: "found"; readonly metadata: DesktopDraftMetadata; readonly conflict: boolean }
  | { readonly status: "blocked" | "locked" | "unavailable" };

export type DraftRecoverOutcome = "recovered" | "locked" | "failed";

/** Lane facets a format surface may bind beyond the shared EditorHandle; the
 * session forwards them opaquely so a mounted lane keeps its own typing. */
type LaneEditorFacets = {
  edit?(operations: readonly PdfEditOperation[]): Promise<void> | void;
  getPdfSnapshot?(): PdfSnapshot | null;
  /** Host page renderer + page geometry, forwarded so the shared surface draws
   * real pages instead of its empty placeholder (U1/U2). */
  renderer?: PdfPageRenderService;
  getCanvasPages?(): readonly PdfCanvasPage[];
  /** Panel engine envelopes (notes, stamps, forms): forwarded so the note and
   * form panels get a provider and can place a real write (F-14). */
  submitEngineOperations?(operations: readonly unknown[]): Promise<{ skipped: readonly { op: string; reason: string }[] } | void>;
  /** Find: the shared surface searches through this facet. The desktop renderer
   * has no pdfium, so the surface reads the engine's text layer (F-13). */
  searchText?(query: string): Promise<readonly PdfSearchHit[]>;
  /** Forms and saved-notes panels read the current bytes through these; without
   * them the forms panel never leaves its loading state (R18-2). */
  readFormFields?(): Promise<readonly PdfFormField[]>;
  readSavedNotes?(): Promise<readonly PdfNoteThread[]>;
  /** Byte-change notify (edit, undo, redo): the PDF editor refreshes its canvas
   * and re-marks dirty after an async undo/redo swap (G-1). */
  subscribe?(listener: () => void): () => void;
  /** Markdown / HTML text facets: the shared text views read and write the
   * one source port; the session only forwards the live lane's facets. */
  source?: DesktopTextFacets["source"];
  getText?(): string;
  setText?(text: string): void;
  getAssetManifest?(): { entries: [] };
  clipboard?: DesktopTextFacets["clipboard"];
  cancel?(): Promise<void>;
};

export type LocalFileRebind = Readonly<{
  previousId: string;
  documentId: string;
  title: string;
  identity: OfficeIdentity;
  bytes: OpenedBytes;
}>;

/** Bind the shared DOCX surface to the accepted byte transport. This adapter
 * owns the renderer half of the ONE 04b draft store: every checkpoint crosses
 * the typed IPC seam, a confirmed save consumes exactly the committed draft,
 * and a crash recovers only the last confirmed row. */
export function createByteDocumentSession(bridge: LibraryBridge, inputIdentity: OfficeIdentity, openedBytes: OpenedBytes, options: {
  createEditor?: (options: DesktopSurfaceSettings) => Promise<DesktopEditorSurface>;
  onLocalRebind?: (next: LocalFileRebind) => void;
  /** How long a checkpoint waits for a Save in flight (default 10 s). */
  saveSettleMaxWaitMs?: number;
} = {}) {
  const identity = { ...inputIdentity };
  const opened = { ...openedBytes };
  let generation = 0;
  let bytes = incomingBytes(opened.data);
  let surface: (DesktopEditorSurface & LaneEditorFacets) | null = null;
  let surfaceOffset = 0;
  let opening: Promise<DesktopEditorSurface> | null = null;
  let disposed = false;
  let unsubscribeDirty: (() => void) | undefined;
  let localHandle = opened.localHandle;
  let localName: string | undefined;
  let saveAsRequested = false;
  let pickerCancelled = false;
  let contextError: unknown;
  let contextRefresh: Promise<void> | undefined;
  // Saves run inside the gate; checkpoints capture only when no Save overlapped.
  const gate = createSaveSettleGate({ maxWaitMs: options.saveSettleMaxWaitMs });
  let confirmedCloudBase: { revision: string; checksum: string } | undefined;
  let saveInProgress = false;
  let rebindingGeneration: number | null = null;
  let rawCoordinator!: ReturnType<typeof createOfficeSaveCoordinator<Uint8Array>>;
  const listeners = new Set<Parameters<typeof rawCoordinator.subscribe>[0]>();
  let unsubscribeCoordinator: (() => void) | undefined;
  let checkpoint: StableSnapshot<Uint8Array> | null = null;
  let pendingIntent: OfficeSaveIntent<Uint8Array> | null = null;
  // One draft id per (document, base): a draft for an older base stays a
  // distinct row and is reported as a conflict instead of an ambiguity.
  const draftIdFor = (target: OfficeIdentity) => `${target.documentId}:${target.baseVersionId}:${target.baseRevision}`;
  const currentIdentity = () => rawCoordinator.getState().identity;
  let generationFloor = 0;
  /** Draft rows this session wrote or read, so discard/commit can name the
   * exact row generation instead of guessing one. */
  const durableRows = new Map<string, number>();
  const checkpointRows = new Map<string, { dirtyGeneration: number; durableGeneration: number }>();
  // Recovery itself does not create a new checkpoint row. Keep the recovered
  // row's identity so a confirmed Save can consume it even when the normal
  // discard callback was unable to observe it during the coordinator settle.
  let recoveredRow: { draftId: string; generation: number } | undefined;

  const listRows = async (): Promise<readonly DesktopDraftMetadata[] | null> => {
    try { return desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId })).drafts; }
    catch { return null; }
  };
  const recoverView = async (): Promise<DraftRecoveryView> => {
    try {
      const listed = desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId }));
      if (listed.locked) return { status: "locked" };
      const rows = [...listed.drafts].sort((left, right) => right.updatedAt - left.updatedAt);
      const newest = rows[0];
      if (!newest) return { status: "none" };
      const current = currentIdentity();
      const conflict = newest.identity.base.revision !== current.baseRevision || newest.identity.base.version !== current.baseVersionId;
      generationFloor = Math.max(generationFloor, newest.generation);
      for (const row of rows) durableRows.set(row.draftId, row.generation);
      return { status: "found", metadata: newest, conflict };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "draft_recovery_locked") return { status: "locked" };
      if (code === "token_expired") return { status: "blocked" };
      return { status: "unavailable" };
    }
  };
  const discardRow = async (draftId: string, generation: number): Promise<boolean> => {
    try {
      desktopDraftDiscardResponseSchema.parse(await bridge.call("desktop:draft-discard", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId, generation: Math.max(1, generation) }));
      durableRows.delete(draftId);
      return true;
    } catch { return false; }
  };
  const consumeRecoveredRow = async (savedGeneration: number): Promise<void> => {
    const recovered = recoveredRow;
    if (!recovered) return;
    const written = checkpointRows.get(recovered.draftId);
    // A checkpoint newer than the confirmed snapshot belongs to N+1 and must
    // survive this Save for a later recovery.
    if (written && written.dirtyGeneration > savedGeneration) {
      recoveredRow = undefined;
      return;
    }
    const row = (await listRows())?.find((candidate) => candidate.draftId === recovered.draftId);
    const generation = row?.generation ?? durableRows.get(recovered.draftId) ?? recovered.generation;
    if (await discardRow(recovered.draftId, generation)) {
      recoveredRow = undefined;
      checkpointRows.delete(recovered.draftId);
      checkpoint = null;
    }
  };

  const editor: DesktopEditorSurface & LaneEditorFacets = {
    format: opened.format, open: async () => { await openEditor(); },
    getDirtyGeneration: () => rebindingGeneration ?? generation,
    captureSnapshot: async () => {
      if (!surface || disposed) throw new Error("docx_snapshot_unavailable");
      const activeSurface = surface;
      const snapshot = await activeSurface.captureSnapshot();
      if (disposed || surface !== activeSurface) throw new Error("docx_snapshot_unavailable");
      return { ...snapshot, generation: snapshot.generation + surfaceOffset };
    },
    get commands() { return surface?.commands; },
    get selection() { return surface?.selection; },
    get edit() { const lane = surface; return lane?.edit?.bind(lane); },
    get getPdfSnapshot() { const lane = surface; return lane?.getPdfSnapshot?.bind(lane); },
    get renderer() { return surface?.renderer; },
    get getCanvasPages() { const lane = surface; return lane?.getCanvasPages?.bind(lane); },
    get submitEngineOperations() { const lane = surface; return lane?.submitEngineOperations?.bind(lane); },
    get searchText() { const lane = surface; return lane?.searchText?.bind(lane); },
    get readFormFields() { const lane = surface; return lane?.readFormFields?.bind(lane); },
    get readSavedNotes() { const lane = surface; return lane?.readSavedNotes?.bind(lane); },
    get subscribe() { const lane = surface; return lane?.subscribe?.bind(lane); },
    get source() { return surface?.source; },
    get getText() { const lane = surface; return lane?.getText?.bind(lane); },
    get setText() { const lane = surface; return lane?.setText?.bind(lane); },
    get getAssetManifest() { const lane = surface; return lane?.getAssetManifest?.bind(lane); },
    get clipboard() { return surface?.clipboard; },
    get cancel() { const lane = surface; return lane?.cancel?.bind(lane); },
    get subscribeDirty() { const lane = surface; return lane?.subscribeDirty?.bind(lane); },
    get openOutcome() { const lane = surface; return lane?.openOutcome?.bind(lane); },
    renderSurface: () => surface?.renderSurface?.() ?? null,
    undo: () => surface?.undo?.(), redo: () => surface?.redo?.(),
    dispose: () => { disposed = true; unsubscribeDirty?.(); bytes = new Uint8Array(); checkpoint = null; pendingIntent = null; return surface?.dispose(); },
  };
  const createSurface = async (source: Uint8Array, initialGeneration: number): Promise<DesktopEditorSurface> => {
    const settings: DesktopSurfaceSettings = { documentId: currentIdentity().documentId, readBytes: async () => source.slice(), generation: initialGeneration, readOnly: opened.canSave === false, bridge, sessionGeneration: SESSION_GENERATION };
    const factory = options.createEditor ?? desktopSurfaceFactory(opened.format);
    if (!factory) throw Object.assign(new Error("desktop_surface_unbound"), { code: "desktop_surface_unbound" });
    const next = await factory(settings);
    try { await next.open(); if (disposed) throw new Error("docx_editor_disposed"); }
    catch (error) { await next.dispose(); throw error; }
    return next;
  };
  const attachSurface = (next: DesktopEditorSurface) => {
    unsubscribeDirty?.(); surface = next; surfaceOffset = 0;
    generation = next.getDirtyGeneration();
    unsubscribeDirty = next.subscribeDirty?.((value) => { generation = value + surfaceOffset; rawCoordinator.markDirty(generation); });
  };
  async function openEditor(): Promise<DesktopEditorSurface> {
    if (disposed) throw new Error("docx_editor_disposed");
    if (surface) return surface;
    opening ??= createSurface(bytes, generation).then((next) => { attachSurface(next); return next; }).catch((error: unknown) => { opening = null; throw error; });
    return opening;
  }
  // Intent memory is session-scoped; durable checkpoints cross the same typed
  // seam for cloud and local work. Main also protects local pre-write bytes.
  const writeRow = async (snapshot: StableSnapshot<Uint8Array>, draftId: string): Promise<void> => {
    const rows = await listRows();
    generationFloor = Math.max(generationFloor, ...(rows ?? []).map((row) => row.generation));
    const next = Math.max(1, generationFloor + 1, snapshot.generation);
    const result = desktopDraftResponseSchema.parse(await bridge.call("desktop:draft-checkpoint", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId, generation: next, data: snapshot.value }));
    checkpoint = snapshot;
    generationFloor = Math.max(generationFloor, result.generation);
    durableRows.set(draftId, result.generation);
    checkpointRows.set(draftId, { dirtyGeneration: snapshot.generation, durableGeneration: result.generation });
  };
  // A receipt advances the draft base and a snapshot read across that rebase
  // would land under the new base. The gate re-captures across any Save and
  // runs `write` in the same turn, so the draft id binds synchronously. A
  // failed read-only context refresh is retried between captures, never inside one.
  const checkpointNow = async (): Promise<void> => {
    for (;;) {
      const outcome = await gate.capture(() => editor.captureSnapshot(), (snapshot) => {
        if (disposed) throw new Error("docx_editor_disposed");
        // A snapshot that the completed Save already persisted needs no draft.
        if (snapshot.generation <= rawCoordinator.getState().lastSavedGeneration) return undefined;
        if (contextError) return "rebind" as const;
        return writeRow(snapshot, draftIdFor(currentIdentity()));
      });
      if (outcome !== "rebind") return;
      await bindDraftContext();
    }
  };
  const draft: DraftAdapter<Uint8Array> = {
    checkpoint: () => checkpointNow(),
    recover: async () => checkpoint,
    // Commit/discard consume only the committed draft: the row for the base the
    // save landed on is deleted, every other base and the N+1 draft are kept.
    discard: async (target, savedGeneration) => {
      const targetId = draftIdFor(target);
      const written = checkpointRows.get(targetId);
      if (savedGeneration !== undefined && written && written.dirtyGeneration > savedGeneration) return;
      const known = durableRows.get(targetId);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      const generation = row?.generation ?? known;
      if (generation === undefined) return;
      if (written && generation !== written.durableGeneration) return;
      const discarded = await discardRow(targetId, generation);
      if (discarded) {
        checkpoint = null;
        if (recoveredRow?.draftId === targetId) recoveredRow = undefined;
      }
    },
    persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent,
    clearIntent: async () => { pendingIntent = null; },
  };
  const outputs = new Map<string, { data: Uint8Array; sizeBytes: number; checksum: string; saveAs: boolean; localBase?: { versionId: string; revision: string }; rebound?: { handle: string; name: string } }>();
  const transport: OfficeSaveTransport<Uint8Array> = {
    serialize: async ({ intent, snapshot }) => {
      const checksum = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(snapshot.value))), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      outputs.set(intent.intentId, { data: snapshot.value, sizeBytes: snapshot.value.length, checksum, saveAs: outputs.get(intent.intentId)?.saveAs ?? saveAsRequested });
      return { data: snapshot.value, sizeBytes: snapshot.value.length, checksumSha256: checksum, format: opened.format };
    },
    upload: async ({ intent, output }) => ({ uploadId: intent.intentId, sizeBytes: output.sizeBytes, checksumSha256: output.checksumSha256, claimExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    commit: async ({ intent }) => {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("snapshot_missing");
      let versionId: string, revision: string, checksum: string;
      if (localHandle) {
        const useSaveAs = output.saveAs || opened.localUntitled === true;
        const result = desktopFileResponseSchema.parse(await bridge.call(useSaveAs ? "desktop:file-save-as" : "desktop:file-save", { sessionGeneration: SESSION_GENERATION, handle: localHandle, data: output.data }));
        throwIfLocalFileFailed(result);
        if (!result.opened && useSaveAs) { pickerCancelled = true; throw Object.assign(new Error("save_as_cancelled"), { code: "save_as_cancelled" }); }
        if (!result.opened || !result.metadata) throw new Error("save_unconfirmed");
        if (result.metadata.checksum !== output.checksum) throw Object.assign(new Error("local_save_checksum_mismatch"), { code: "local_save_checksum_mismatch" });
        // Local revisions are decimal strings; never feed a non-integer value
        // (a fractional Windows mtime) into BigInt.
        versionId = result.metadata.checksum; checksum = result.metadata.checksum;
        output.localBase = { versionId, revision: String(Math.trunc(result.metadata.modifiedAtMs)) };
        // A new file may have an older mtime than its source. The coordinator
        // requires an advancing receipt; immediately restore the actual file
        // base after accepting it so draft recovery compares the real mtime.
        revision = String(BigInt(output.localBase.revision) > BigInt(intent.identity.baseRevision) ? BigInt(output.localBase.revision) : BigInt(intent.identity.baseRevision) + 1n);
        if (useSaveAs && result.metadata.handle !== localHandle) output.rebound = { handle: result.metadata.handle, name: result.metadata.name };
      } else {
        const result = desktopOfficeSaveResponseSchema.parse(await bridge.call("desktop:office-save", { sessionGeneration: SESSION_GENERATION, workspaceId: identity.workspaceId, documentId: identity.documentId, format: opened.format, intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, baseVersionId: intent.identity.baseVersionId, baseRevision: intent.identity.baseRevision, data: output.data, checksum: output.checksum }));
        if (result.documentId !== intent.identity.documentId || result.intentId !== intent.intentId || result.idempotencyKey !== intent.idempotencyKey || result.checksum !== output.checksum) throw Object.assign(new Error("office_receipt_mismatch"), { code: "office_receipt_mismatch" });
        versionId = result.versionId; revision = result.revision; checksum = result.checksum;
      }
      // Confirmed: the identity advances and the save source rebases from here.
      gate.markRebase();
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: intent.identity.documentId, versionId, revision, checksumSha256: checksum, sizeBytes: output.sizeBytes, engineName: opened.format, engineVersion: desktopEngineBuild(opened.format), contractVersion: "office-editor-host/1", protocolVersion: "1" };
    },
    // Settled without a commit: the retained serialized bytes end here.
    release: async ({ intent }) => { outputs.delete(intent.intentId); },
    reconcile: async () => null,
  };
  const publish = () => { for (const listener of listeners) listener(rawCoordinator.getState()); };
  const bindCoordinator = (target: OfficeIdentity) => {
    unsubscribeCoordinator?.();
    rawCoordinator = createOfficeSaveCoordinator({ identity: target, editor, draft, transport });
    unsubscribeCoordinator = rawCoordinator.subscribe(publish);
  };
  bindCoordinator(identity);
  const resetCoordinator = (target: OfficeIdentity, savedGeneration: number) => {
    rebindingGeneration = savedGeneration;
    try { bindCoordinator(target); } finally { rebindingGeneration = null; }
    if (generation > savedGeneration) rawCoordinator.markDirty(generation);
    publish();
  };
  const bindDraftContext = (): Promise<void> => {
    contextRefresh ??= (async () => {
      if (localHandle) {
        const handle = localHandle;
        const result = desktopFileResponseSchema.parse(await bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle }));
        throwIfLocalFileFailed(result);
        if (disposed || !result.opened || result.metadata?.handle !== handle || localHandle !== handle) throw new Error("local_rebind_unconfirmed");
      } else {
        const target = currentIdentity();
        const confirmed = confirmedCloudBase;
        const result = desktopOfficeOpenResponseSchema.parse(await bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: target.workspaceId, documentId: target.documentId }));
        if (disposed || !confirmed || currentIdentity().documentId !== target.documentId || result.document.id !== target.documentId || result.document.workspaceId !== target.workspaceId || !result.document.canEdit || result.document.revision !== confirmed.revision || result.checksum !== confirmed.checksum) throw new Error("cloud_rebind_unconfirmed");
        // Main records the current numeric document version on this read-only
        // open. Keep it for draft bases while retaining the opaque Save receipt.
        // Downloaded bytes never replace this editor or its pending N+1 edits.
        rawCoordinator.setIdentity({ ...target, baseVersionId: String(result.document.version), baseRevision: result.document.revision });
      }
      contextError = undefined;
    })().finally(() => { contextRefresh = undefined; });
    return contextRefresh;
  };
  const coordinator = {
    getState: () => rawCoordinator.getState(),
    subscribe(listener: Parameters<typeof rawCoordinator.subscribe>[0]) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    markDirty(value: number) { if (surface && value > generation) surfaceOffset += value - generation; generation = Math.max(generation, value); rawCoordinator.markDirty(generation); },
    setCapability: (entry: Parameters<typeof rawCoordinator.setCapability>[0]) => rawCoordinator.setCapability(entry),
    checkpoint: () => rawCoordinator.checkpoint(), cancel: () => rawCoordinator.cancel(),
    async save(entryPoint?: Parameters<typeof rawCoordinator.save>[0]): Promise<SaveAttemptResult> {
      if (saveInProgress) return { accepted: false, reason: "saving" };
      if (!surface || disposed) return { accepted: false, reason: "readonly" };
      saveInProgress = true;
      try {
      return await gate.run(async () => {
      if (contextError) await bindDraftContext();
      const result = await rawCoordinator.save(entryPoint);
      if (result.accepted) {
        await surface?.rebaseSaveSource?.(result.receipt);
        await consumeRecoveredRow(rawCoordinator.getState().lastSavedGeneration);
        const output = outputs.get(result.intentId);
        if (output?.rebound) {
          // Re-open only the new opaque handle to update main's local draft
          // context. No path or new file write is sent by this rebind.
          const previousId = identity.documentId;
          localHandle = output.rebound.handle; localName = output.rebound.name;
          identity.documentId = localHandle;
          identity.baseVersionId = output.localBase!.versionId;
          identity.baseRevision = output.localBase!.revision;
          opened.localHandle = localHandle;
          opened.localUntitled = false;
          opened.checksum = output.localBase!.versionId;
          const nextIdentity = { ...rawCoordinator.getState().identity, documentId: localHandle, baseVersionId: output.localBase!.versionId, baseRevision: output.localBase!.revision };
          resetCoordinator(nextIdentity, rawCoordinator.getState().lastSavedGeneration);
          options.onLocalRebind?.({ previousId, documentId: localHandle, title: output.rebound.name, identity: nextIdentity, bytes: { ...opened, localHandle, localUntitled: false, checksum: output.localBase!.versionId } });
          // The file is already confirmed: retain that receipt and descriptor
          // even if the read-only context refresh fails. Draft writes then
          // refuse until a subsequent refresh succeeds.
          await bindDraftContext().catch((error: unknown) => { contextError = error; });
        } else if (output?.localBase) {
          rawCoordinator.setIdentity({ ...rawCoordinator.getState().identity, baseVersionId: output.localBase.versionId, baseRevision: output.localBase.revision });
          await bindDraftContext().catch((error: unknown) => { contextError = error; });
        } else if (!localHandle && output) {
          confirmedCloudBase = { revision: result.receipt.revision, checksum: output.checksum };
          await bindDraftContext().catch((error: unknown) => { contextError = error; });
        }
        outputs.delete(result.intentId);
      }
      return result;
      });
      } catch (error) {
        if (disposed) return { accepted: false, reason: "stale" };
        throw error;
      } finally { saveInProgress = false; }
    },
  };
  if (opened.canSave === false) coordinator.setCapability({ format: opened.format, operation: "serialize", host: "desktop", engineBuild: desktopEngineBuild(opened.format), contractRevision: "office-editor-host/1", status: "readonly", fidelityWarnings: [] });
  const captured = async (): Promise<StableSnapshot<Uint8Array> | null> => {
    const snapshot = await editor.captureSnapshot();
    return snapshot.generation === editor.getDirtyGeneration() ? snapshot : null;
  };
  return {
    editor,
    coordinator,
    openEditor,
    async saveAs(): Promise<SaveAttemptResult | { accepted: false; reason: "cancelled" }> {
      if (!localHandle || !surface || opened.canSave === false) return { accepted: false, reason: "readonly" };
      const state = coordinator.getState();
      if (state.state === "saving" || saveAsRequested || saveInProgress) return { accepted: false, reason: "saving" };
      if (state.state !== "ready" && state.state !== "saved" && state.state !== "dirty") return { accepted: false, reason: "blocked" };
      const syntheticEdit = state.dirtyGeneration === state.lastSavedGeneration;
      if (syntheticEdit) coordinator.markDirty(generation + 1);
      pickerCancelled = false;
      saveAsRequested = true;
      try {
        const result = await coordinator.save("button");
        if (!pickerCancelled) return result;
        if (syntheticEdit) { surfaceOffset--; generation--; }
        resetCoordinator(state.identity, state.lastSavedGeneration);
        for (const [key, output] of outputs) if (output.saveAs) outputs.delete(key);
        return { accepted: false, reason: "cancelled" };
      } finally { saveAsRequested = false; }
    },
    /** Keep confirms an encrypted checkpoint for the current edits. This is
     * independent of the main process's pre-write protection for local Save. */
    async keepDraft(): Promise<boolean> {
      const state = coordinator.getState();
      if (state.state === "ready" || state.state === "saved") return true;
      const snapshot = await captured().catch(() => null);
      if (!snapshot) return false;
      try { await draft.checkpoint(snapshot); return true; } catch { return false; }
    },
    /** Discard consumes the chosen row when the caller names it (a conflict row
     * is stored under its own older-base id) and otherwise the current base row. */
    async discardDraft(metadata?: DesktopDraftMetadata): Promise<boolean> {
      checkpoint = null;
      const targetId = metadata?.draftId ?? draftIdFor(currentIdentity());
      if (metadata) {
        const discarded = await discardRow(metadata.draftId, metadata.generation);
        if (discarded && recoveredRow?.draftId === metadata.draftId) recoveredRow = undefined;
        return discarded;
      }
      const known = durableRows.get(targetId);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      if (!row) return known === undefined;
      return discardRow(targetId, row.generation);
    },
    /** Lists this document's drafts and reports the newest one for its base. */
    listDrafts: recoverView,
    /** Recover applies the chosen durable draft into the editor bytes. */
    async recoverDraft(metadata: DesktopDraftMetadata): Promise<DraftRecoverOutcome> {
      try {
        if (opened.canSave === false) return "failed";
        const current = currentIdentity();
        const result = desktopDraftRecoveryResponseSchema.parse(await bridge.call("desktop:draft-recover", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId: metadata.draftId, currentBase: { revision: current.baseRevision, version: current.baseVersionId } }));
        if (result.status === "locked") return "locked";
        if (result.status !== "recovered") return "failed";
        await openEditor();
        const recovered = incomingBytes(result.data);
        const next = await createSurface(recovered, generation + 1);
        const previous = surface;
        attachSurface(next); bytes = recovered;
        await previous?.dispose();
        generationFloor = Math.max(generationFloor, result.metadata.generation);
        durableRows.set(result.metadata.draftId, result.metadata.generation);
        recoveredRow = { draftId: result.metadata.draftId, generation: result.metadata.generation };
        checkpoint = null;
        coordinator.markDirty(generation);
        return "recovered";
      } catch (error) { return (error as { code?: string }).code === "draft_recovery_locked" ? "locked" : "failed"; }
    },
    dispose: () => { gate.dispose(); unsubscribeCoordinator?.(); listeners.clear(); outputs.clear(); void coordinator.cancel(); void editor.dispose(); },
    get snapshotChecksum(): string { return opened.checksum; },
    get localHandle(): string | undefined { return localHandle; },
    get localName(): string | undefined { return localName; },
    get localUntitled(): boolean { return opened.localUntitled === true; },
    get canSave(): boolean { return opened.canSave !== false; },
    get isDisposed(): boolean { return disposed; },
  };
}

export type ByteDocumentSession = ReturnType<typeof createByteDocumentSession>;
