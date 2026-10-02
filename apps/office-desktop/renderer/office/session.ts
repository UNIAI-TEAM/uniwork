import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot, SaveAttemptResult } from "@uniwork/core/office";
import type { DocxEditorHandle } from "@uniwork/views/office/docx";
import type { DesktopDocxSurface } from "./docx-surface";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, desktopDraftRecoveryResponseSchema, desktopDraftResponseSchema, desktopFileResponseSchema, desktopOfficeSaveResponseSchema, type DesktopDraftMetadata } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";

export type OpenedBytes = { dataBase64: string; checksum: string; localHandle?: string; canSave?: boolean };

const SESSION_GENERATION = "desktop-dev-session";

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export type DraftRecoveryView =
  | { readonly status: "none" }
  | { readonly status: "found"; readonly metadata: DesktopDraftMetadata; readonly conflict: boolean }
  | { readonly status: "blocked" | "locked" | "unavailable" };

/** Bind the shared DOCX surface to the accepted byte transport. This adapter
 * owns the renderer half of the ONE 04b draft store: every checkpoint crosses
 * the typed IPC seam, a confirmed save consumes exactly the committed draft,
 * and a crash recovers only the last confirmed row. */
export function createByteDocumentSession(bridge: LibraryBridge, identity: OfficeIdentity, opened: OpenedBytes, options: {
  createEditor?: (options: { documentId: string; readBytes(): Promise<Uint8Array>; generation: number; readOnly: boolean }) => Promise<DesktopDocxSurface>;
} = {}) {
  let generation = 0;
  let bytes = decode(opened.dataBase64);
  let surface: DesktopDocxSurface | null = null;
  let surfaceOffset = 0;
  let opening: Promise<DesktopDocxSurface> | null = null;
  let disposed = false;
  let unsubscribeDirty: (() => void) | undefined;
  let localHandle = opened.localHandle;
  let localName: string | undefined;
  let saveAsRequested = false;
  let pickerCancelled = false;
  let localContextError: unknown;
  let localContextRefresh: Promise<void> | undefined;
  let localSaveSettled: Promise<void> | undefined;
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

  const listRows = async (): Promise<readonly DesktopDraftMetadata[] | null> => {
    try { return desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION })).drafts; }
    catch { return null; }
  };
  const recoverView = async (): Promise<DraftRecoveryView> => {
    try {
      const listed = desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION }));
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
      desktopDraftDiscardResponseSchema.parse(await bridge.call("desktop:draft-discard", { sessionGeneration: SESSION_GENERATION, draftId, generation: Math.max(1, generation) }));
      durableRows.delete(draftId);
      return true;
    } catch { return false; }
  };

  const editor: DocxEditorHandle<Uint8Array> = {
    format: "docx", open: async () => { await openEditor(); },
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
    renderSurface: () => surface?.renderSurface?.() ?? null,
    undo: () => surface?.undo?.(), redo: () => surface?.redo?.(),
    dispose: () => { disposed = true; unsubscribeDirty?.(); bytes = new Uint8Array(); checkpoint = null; pendingIntent = null; return surface?.dispose(); },
  };
  const createSurface = async (source: Uint8Array, initialGeneration: number) => {
    const settings = { documentId: currentIdentity().documentId, readBytes: async () => source.slice(), generation: initialGeneration, readOnly: opened.canSave === false };
    const next = options.createEditor ? await options.createEditor(settings) : (await import("./docx-surface")).createDesktopDocxSurface(settings);
    try { await next.open(); if (disposed) throw new Error("docx_editor_disposed"); }
    catch (error) { await next.dispose(); throw error; }
    return next;
  };
  const attachSurface = (next: DesktopDocxSurface) => {
    unsubscribeDirty?.(); surface = next; surfaceOffset = 0;
    generation = next.getDirtyGeneration();
    unsubscribeDirty = next.subscribeDirty?.((value) => { generation = value + surfaceOffset; rawCoordinator.markDirty(generation); });
  };
  async function openEditor(): Promise<DesktopDocxSurface> {
    if (disposed) throw new Error("docx_editor_disposed");
    if (surface) return surface;
    opening ??= createSurface(bytes, generation).then((next) => { attachSurface(next); return next; }).catch((error: unknown) => { opening = null; throw error; });
    return opening;
  }
  // Intent memory is session-scoped; durable checkpoints cross the same typed
  // seam for cloud and local work. Main also protects local pre-write bytes.
  const draft: DraftAdapter<Uint8Array> = {
    checkpoint: async (snapshot) => {
      // A local receipt advances the draft base. Wait through the write and
      // read-only context refresh before assigning N+1 to that new base.
      if (localSaveSettled) await localSaveSettled;
      if (disposed) throw new Error("docx_editor_disposed");
      // A snapshot that the completed Save already persisted needs no draft.
      if (localHandle && snapshot.generation <= rawCoordinator.getState().lastSavedGeneration) return;
      if (localContextError) await bindLocalContext();
      const draftId = draftIdFor(currentIdentity());
      const rows = await listRows();
      generationFloor = Math.max(generationFloor, ...(rows ?? []).map((row) => row.generation));
      const next = Math.max(1, generationFloor + 1, snapshot.generation);
      const result = desktopDraftResponseSchema.parse(await bridge.call("desktop:draft-checkpoint", { sessionGeneration: SESSION_GENERATION, draftId, generation: next, dataBase64: encode(snapshot.value) }));
      checkpoint = snapshot;
      generationFloor = Math.max(generationFloor, result.generation);
      durableRows.set(draftId, result.generation);
      checkpointRows.set(draftId, { dirtyGeneration: snapshot.generation, durableGeneration: result.generation });
    },
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
      await discardRow(targetId, generation);
      checkpoint = null;
    },
    persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent,
    clearIntent: async () => { pendingIntent = null; },
  };
  const outputs = new Map<string, { dataBase64: string; sizeBytes: number; checksum: string; saveAs: boolean; localBase?: { versionId: string; revision: string }; rebound?: { handle: string; name: string } }>();
  const transport: OfficeSaveTransport<Uint8Array> = {
    serialize: async ({ intent, snapshot }) => {
      const checksum = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(snapshot.value))), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      outputs.set(intent.intentId, { dataBase64: encode(snapshot.value), sizeBytes: snapshot.value.length, checksum, saveAs: outputs.get(intent.intentId)?.saveAs ?? saveAsRequested });
      return { data: snapshot.value, sizeBytes: snapshot.value.length, checksumSha256: checksum, format: "docx" };
    },
    upload: async ({ intent, output }) => ({ uploadId: intent.intentId, sizeBytes: output.sizeBytes, checksumSha256: output.checksumSha256, claimExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    commit: async ({ intent }) => {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("snapshot_missing");
      let versionId: string, revision: string, checksum: string;
      if (localHandle) {
        const result = desktopFileResponseSchema.parse(await bridge.call(output.saveAs ? "desktop:file-save-as" : "desktop:file-save", { sessionGeneration: SESSION_GENERATION, handle: localHandle, dataBase64: output.dataBase64 }));
        if (!result.opened && output.saveAs) { pickerCancelled = true; throw Object.assign(new Error("save_as_cancelled"), { code: "save_as_cancelled" }); }
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
        if (output.saveAs) output.rebound = { handle: result.metadata.handle, name: result.metadata.name };
      } else {
        const result = desktopOfficeSaveResponseSchema.parse(await bridge.call("desktop:office-save", { sessionGeneration: SESSION_GENERATION, workspaceId: identity.workspaceId, documentId: identity.documentId, intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, baseVersionId: intent.identity.baseVersionId, baseRevision: intent.identity.baseRevision, dataBase64: output.dataBase64, checksum: output.checksum }));
        if (result.documentId !== intent.identity.documentId || result.intentId !== intent.intentId || result.idempotencyKey !== intent.idempotencyKey || result.checksum !== output.checksum) throw Object.assign(new Error("office_receipt_mismatch"), { code: "office_receipt_mismatch" });
        versionId = result.versionId; revision = result.revision; checksum = result.checksum;
      }
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: intent.identity.documentId, versionId, revision, checksumSha256: checksum, sizeBytes: output.sizeBytes, engineName: "docx", engineVersion: "09485f884dc845cf3bf27fb7edfe489f9d457aad", contractVersion: "office-editor-host/1", protocolVersion: "1" };
    },
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
  const bindLocalContext = (): Promise<void> => {
    localContextRefresh ??= (async () => {
      const handle = localHandle!;
      const result = desktopFileResponseSchema.parse(await bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle }));
      if (disposed || !result.opened || result.metadata?.handle !== handle || localHandle !== handle) throw new Error("local_rebind_unconfirmed");
      localContextError = undefined;
    })().finally(() => { localContextRefresh = undefined; });
    return localContextRefresh;
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
      let releaseLocalSave: (() => void) | undefined;
      if (localHandle) localSaveSettled = new Promise<void>((resolve) => { releaseLocalSave = resolve; });
      try {
      if (localContextError) await bindLocalContext();
      const result = await rawCoordinator.save(entryPoint);
      if (result.accepted) {
        const output = outputs.get(result.intentId);
        if (output?.rebound) {
          // Re-open only the new opaque handle to update main's local draft
          // context. No path or new file write is sent by this rebind.
          localHandle = output.rebound.handle; localName = output.rebound.name;
          resetCoordinator({ ...rawCoordinator.getState().identity, documentId: localHandle, baseVersionId: output.localBase!.versionId, baseRevision: output.localBase!.revision }, rawCoordinator.getState().lastSavedGeneration);
          // The file is already confirmed: retain that receipt and descriptor
          // even if the read-only context refresh fails. Draft writes then
          // refuse until a subsequent refresh succeeds.
          await bindLocalContext().catch((error: unknown) => { localContextError = error; });
        } else if (output?.localBase) {
          rawCoordinator.setIdentity({ ...rawCoordinator.getState().identity, baseVersionId: output.localBase.versionId, baseRevision: output.localBase.revision });
          await bindLocalContext().catch((error: unknown) => { localContextError = error; });
        }
        outputs.delete(result.intentId);
      }
      return result;
      } catch (error) {
        if (disposed) return { accepted: false, reason: "stale" };
        throw error;
      } finally { saveInProgress = false; releaseLocalSave?.(); localSaveSettled = undefined; }
    },
  };
  if (opened.canSave === false) coordinator.setCapability({ format: "docx", operation: "serialize", host: "desktop", engineBuild: "09485f884dc845cf3bf27fb7edfe489f9d457aad", contractRevision: "office-editor-host/1", status: "readonly", fidelityWarnings: [] });
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
      if (metadata) return discardRow(metadata.draftId, metadata.generation);
      const known = durableRows.get(targetId);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      if (!row) return known === undefined;
      return discardRow(targetId, row.generation);
    },
    /** Lists this document's drafts and reports the newest one for its base. */
    listDrafts: recoverView,
    /** Recover applies the chosen durable draft into the editor bytes. */
    async recoverDraft(metadata: DesktopDraftMetadata): Promise<boolean> {
      try {
        if (opened.canSave === false) return false;
        const current = currentIdentity();
        const result = desktopDraftRecoveryResponseSchema.parse(await bridge.call("desktop:draft-recover", { sessionGeneration: SESSION_GENERATION, draftId: metadata.draftId, currentBase: { revision: current.baseRevision, version: current.baseVersionId } }));
        if (result.status !== "recovered") return false;
        await openEditor();
        const recovered = decode(result.dataBase64);
        const next = await createSurface(recovered, generation + 1);
        const previous = surface;
        attachSurface(next); bytes = recovered;
        await previous?.dispose();
        generationFloor = Math.max(generationFloor, result.metadata.generation);
        durableRows.set(result.metadata.draftId, result.metadata.generation);
        checkpoint = null;
        coordinator.markDirty(generation);
        return true;
      } catch { return false; }
    },
    dispose: () => { unsubscribeCoordinator?.(); listeners.clear(); outputs.clear(); void coordinator.cancel(); void editor.dispose(); },
    get snapshotChecksum(): string { return opened.checksum; },
    get localHandle(): string | undefined { return localHandle; },
    get localName(): string | undefined { return localName; },
    get canSave(): boolean { return opened.canSave !== false; },
    get isDisposed(): boolean { return disposed; },
  };
}

export type ByteDocumentSession = ReturnType<typeof createByteDocumentSession>;
