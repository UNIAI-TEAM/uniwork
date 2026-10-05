import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, EditorHandle, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import type { DesktopPptxAdapter } from "./pptx-adapter";
import type { DesktopPptxSurface } from "./pptx-surface";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, desktopDraftRecoveryResponseSchema, desktopDraftResponseSchema, desktopFileResponseSchema, desktopOfficeOpenResponseSchema, desktopOfficeSaveResponseSchema, type DesktopDraftMetadata } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";
import type { OpenedBytes } from "./session";
import type { PptxDeckSnapshot } from "./pptx-runtime";

const SESSION_GENERATION = "desktop-dev-session";

function encode(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type PptxDraftRecoveryView =
  | { readonly status: "none" }
  | { readonly status: "found"; readonly metadata: DesktopDraftMetadata; readonly conflict: boolean }
  | { readonly status: "blocked" | "locked" | "unavailable" };

export type PptxDraftRecoverOutcome = "recovered" | "locked" | "failed";

/** The PPTX counterpart of createByteDocumentSession: the same ONE draft store,
 * the same typed IPC channels and the same cloud/local save shape, but the
 * editor handle owns a deck snapshot (journal) that the runtime serializes to
 * pptx bytes. Main still performs every file/cloud write; the renderer never
 * touches Node. */
export function createPptxDocumentSession(
  bridge: LibraryBridge,
  inputIdentity: OfficeIdentity,
  openedBytes: OpenedBytes,
  createSurface: (onDirty: (generation: number) => void) => DesktopPptxAdapter,
  options: { onLocalRebind?: (next: { previousId: string; documentId: string; title: string; identity: OfficeIdentity; bytes: OpenedBytes }) => void } = {},
) {
  const identity = { ...inputIdentity };
  let localHandle = openedBytes.localHandle;
  let localName: string | undefined;
  let disposed = false;
  let pendingIntent: OfficeSaveIntent<PptxDeckSnapshot> | null = null;
  let generationFloor = 0;
  let saveInProgress = false;
  let saveSettled: Promise<void> | undefined;
  let confirmedCloudBase: { revision: string; checksum: string } | undefined;
  const durableRows = new Map<string, number>();
  const checkpointRows = new Map<string, { dirtyGeneration: number; durableGeneration: number }>();
  let recoveredRow: { draftId: string; generation: number } | undefined;
  let checkpoint: StableSnapshot<PptxDeckSnapshot> | null = null;
  const outputs = new Map<string, { dataBase64: string; sizeBytes: number; checksum: string; saveAs: boolean; localBase?: { versionId: string; revision: string }; rebound?: { handle: string; name: string } }>();
  let saveAsRequested = false;
  let pickerCancelled = false;

  // The surface reports an edit before the coordinator exists; the holder is
  // filled right after construction and every edit lands after that.
  let markDirty: (generation: number) => void = () => undefined;
  const surface: DesktopPptxSurface = createSurface((value) => markDirty(value)).editor;
  const draftIdFor = (target: OfficeIdentity) => `${target.documentId}:${target.baseVersionId}:${target.baseRevision}`;
  const currentIdentity = () => rawCoordinator.getState().identity;
  const listRows = async (): Promise<readonly DesktopDraftMetadata[] | null> => {
    try { return desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId })).drafts; }
    catch { return null; }
  };
  const discardRow = async (draftId: string, generation: number): Promise<boolean> => {
    try {
      desktopDraftDiscardResponseSchema.parse(await bridge.call("desktop:draft-discard", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId, generation: Math.max(1, generation) }));
      durableRows.delete(draftId);
      return true;
    } catch { return false; }
  };
  const recoverView = async (): Promise<PptxDraftRecoveryView> => {
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
  const consumeRecoveredRow = async (savedGeneration: number): Promise<void> => {
    const recovered = recoveredRow;
    if (!recovered) return;
    const written = checkpointRows.get(recovered.draftId);
    if (written && written.dirtyGeneration > savedGeneration) { recoveredRow = undefined; return; }
    const row = (await listRows())?.find((candidate) => candidate.draftId === recovered.draftId);
    const generation = row?.generation ?? durableRows.get(recovered.draftId) ?? recovered.generation;
    if (await discardRow(recovered.draftId, generation)) { recoveredRow = undefined; checkpointRows.delete(recovered.draftId); checkpoint = null; }
  };

  const editor: EditorHandle<PptxDeckSnapshot> = {
    format: "pptx",
    open: () => surface.open(),
    getDirtyGeneration: () => surface.getDirtyGeneration(),
    captureSnapshot: () => surface.captureSnapshot(),
    undo: () => surface.undo(),
    redo: () => surface.redo(),
    dispose: () => { disposed = true; checkpoint = null; pendingIntent = null; return surface.dispose(); },
  };

  const draft: DraftAdapter<PptxDeckSnapshot> = {
    checkpoint: async (snapshot) => {
      if (saveSettled) await saveSettled;
      if (disposed) throw new Error("pptx_editor_disposed");
      if (snapshot.generation <= rawCoordinator.getState().lastSavedGeneration) return;
      const draftId = draftIdFor(currentIdentity());
      const rows = await listRows();
      generationFloor = Math.max(generationFloor, ...(rows ?? []).map((row) => row.generation));
      const next = Math.max(1, generationFloor + 1, snapshot.generation);
      const payload = encode(new TextEncoder().encode(JSON.stringify(snapshot.value)));
      const result = desktopDraftResponseSchema.parse(await bridge.call("desktop:draft-checkpoint", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId, generation: next, dataBase64: payload }));
      checkpoint = snapshot;
      generationFloor = Math.max(generationFloor, result.generation);
      durableRows.set(draftId, result.generation);
      checkpointRows.set(draftId, { dirtyGeneration: snapshot.generation, durableGeneration: result.generation });
    },
    recover: async () => checkpoint,
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
      if (discarded) { checkpoint = null; if (recoveredRow?.draftId === targetId) recoveredRow = undefined; }
    },
    persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent,
    clearIntent: async () => { pendingIntent = null; },
  };

  const transport: OfficeSaveTransport<PptxDeckSnapshot> = {
    serialize: async ({ intent, snapshot }) => {
      const result = await surface.serialize(snapshot, intent.intentId);
      const checksum = result.checksum.startsWith("sha256:") ? result.checksum : `sha256:${result.checksum}`;
      outputs.set(intent.intentId, { dataBase64: encode(result.bytes), sizeBytes: result.bytes.length, checksum, saveAs: outputs.get(intent.intentId)?.saveAs ?? saveAsRequested });
      return { data: result.bytes, sizeBytes: result.bytes.length, checksumSha256: checksum, format: "pptx" };
    },
    upload: async ({ intent, output }) => ({ uploadId: intent.intentId, sizeBytes: output.sizeBytes, checksumSha256: output.checksumSha256, claimExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    commit: async ({ intent }) => {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("snapshot_missing");
      let versionId: string, revision: string, checksum: string;
      if (localHandle) {
        const useSaveAs = output.saveAs || openedBytes.localUntitled === true;
        const result = desktopFileResponseSchema.parse(await bridge.call(useSaveAs ? "desktop:file-save-as" : "desktop:file-save", { sessionGeneration: SESSION_GENERATION, handle: localHandle, dataBase64: output.dataBase64 }));
        if (!result.opened && useSaveAs) { pickerCancelled = true; throw Object.assign(new Error("save_as_cancelled"), { code: "save_as_cancelled" }); }
        if (!result.opened || !result.metadata) throw new Error("save_unconfirmed");
        if (result.metadata.checksum !== output.checksum) throw Object.assign(new Error("local_save_checksum_mismatch"), { code: "local_save_checksum_mismatch" });
        versionId = result.metadata.checksum; checksum = result.metadata.checksum;
        output.localBase = { versionId, revision: String(Math.trunc(result.metadata.modifiedAtMs)) };
        revision = String(BigInt(output.localBase.revision) > BigInt(intent.identity.baseRevision) ? BigInt(output.localBase.revision) : BigInt(intent.identity.baseRevision) + 1n);
        if (useSaveAs && result.metadata.handle !== localHandle) output.rebound = { handle: result.metadata.handle, name: result.metadata.name };
      } else {
        const result = desktopOfficeSaveResponseSchema.parse(await bridge.call("desktop:office-save", { sessionGeneration: SESSION_GENERATION, workspaceId: identity.workspaceId, documentId: identity.documentId, format: "pptx", intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, baseVersionId: intent.identity.baseVersionId, baseRevision: intent.identity.baseRevision, dataBase64: output.dataBase64, checksum: output.checksum }));
        if (result.documentId !== intent.identity.documentId || result.intentId !== intent.intentId || result.idempotencyKey !== intent.idempotencyKey || result.checksum !== output.checksum) throw Object.assign(new Error("office_receipt_mismatch"), { code: "office_receipt_mismatch" });
        versionId = result.versionId; revision = result.revision; checksum = result.checksum;
      }
      // The write is confirmed: those bytes are the base the next draft row is
      // keyed by, so the journal drops what they hold (W14). Checkpoints wait on
      // saveSettled, so none can land between this rebase and the new identity.
      await surface.setBaseRevision(revision, intent.intentId);
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: intent.identity.documentId, versionId, revision, checksumSha256: checksum, sizeBytes: output.sizeBytes, engineName: "pptx", engineVersion: "09485f884dc845cf3bf27fb7edfe489f9d457aad", contractVersion: "office-editor-host/1", protocolVersion: "1" };
    },
    reconcile: async () => null,
  };

  markDirty = (value) => rawCoordinator.markDirty(value);
  const listeners = new Set<(state: ReturnType<typeof rawCoordinator.getState>) => void>();
  const publish = () => { for (const listener of listeners) listener(rawCoordinator.getState()); };
  let rawCoordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport });
  let unsubscribeCoordinator = rawCoordinator.subscribe(publish);
  const bindCoordinator = (target: OfficeIdentity) => { unsubscribeCoordinator(); rawCoordinator = createOfficeSaveCoordinator({ identity: target, editor, draft, transport }); unsubscribeCoordinator = rawCoordinator.subscribe(publish); };

  const bindDraftContext = async (): Promise<void> => {
    if (localHandle) {
      const handle = localHandle;
      const result = desktopFileResponseSchema.parse(await bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle }));
      if (disposed || !result.opened || result.metadata?.handle !== handle || localHandle !== handle) throw new Error("local_rebind_unconfirmed");
      return;
    }
    const target = currentIdentity();
    const confirmed = confirmedCloudBase;
    const result = desktopOfficeOpenResponseSchema.parse(await bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: target.workspaceId, documentId: target.documentId }));
    if (disposed || !confirmed || currentIdentity().documentId !== target.documentId || result.document.id !== target.documentId || result.document.workspaceId !== target.workspaceId || !result.document.canEdit || result.document.revision !== confirmed.revision || result.checksum !== confirmed.checksum) throw new Error("cloud_rebind_unconfirmed");
    rawCoordinator.setIdentity({ ...target, baseVersionId: String(result.document.version), baseRevision: result.document.revision });
  };

  const coordinator = {
    getState: () => rawCoordinator.getState(),
    subscribe(listener: (state: ReturnType<typeof rawCoordinator.getState>) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    markDirty(value: number) { rawCoordinator.markDirty(value); },
    setCapability: (entry: Parameters<typeof rawCoordinator.setCapability>[0]) => rawCoordinator.setCapability(entry),
    checkpoint: () => rawCoordinator.checkpoint(),
    cancel: () => rawCoordinator.cancel(),
    async save(entryPoint?: Parameters<typeof rawCoordinator.save>[0]) {
      if (saveInProgress) return { accepted: false as const, reason: "saving" as const };
      if (disposed) return { accepted: false as const, reason: "readonly" as const };
      saveInProgress = true;
      let releaseSave!: () => void;
      saveSettled = new Promise<void>((resolve) => { releaseSave = resolve; });
      try {
        const result = await rawCoordinator.save(entryPoint);
        if (result.accepted) {
          await consumeRecoveredRow(rawCoordinator.getState().lastSavedGeneration);
          const output = outputs.get(result.intentId);
          if (output?.rebound) {
            const previousId = identity.documentId;
            localHandle = output.rebound.handle; localName = output.rebound.name;
            identity.documentId = localHandle;
            identity.baseVersionId = output.localBase!.versionId;
            identity.baseRevision = output.localBase!.revision;
            openedBytes.localHandle = localHandle;
            openedBytes.localUntitled = false;
            openedBytes.checksum = output.localBase!.versionId;
            const nextIdentity = { ...rawCoordinator.getState().identity, documentId: localHandle, baseVersionId: output.localBase!.versionId, baseRevision: output.localBase!.revision };
            bindCoordinator(nextIdentity);
            options.onLocalRebind?.({ previousId, documentId: localHandle, title: output.rebound.name, identity: nextIdentity, bytes: { ...openedBytes, localHandle, localUntitled: false, checksum: output.localBase!.versionId } });
            await bindDraftContext().catch(() => undefined);
          } else if (output?.localBase) {
            rawCoordinator.setIdentity({ ...rawCoordinator.getState().identity, baseVersionId: output.localBase.versionId, baseRevision: output.localBase.revision });
            await bindDraftContext().catch(() => undefined);
          } else if (!localHandle && output) {
            confirmedCloudBase = { revision: result.receipt.revision, checksum: output.checksum };
            await bindDraftContext().catch(() => undefined);
          }
          outputs.delete(result.intentId);
        }
        return result;
      } finally { saveInProgress = false; releaseSave(); saveSettled = undefined; }
    },
  };

  const openEditor = async (): Promise<DesktopPptxSurface> => {
    await surface.open();
    return surface;
  };
  return {
    editor: surface,
    coordinator,
    openEditor,
    async saveAs() {
      if (!localHandle || openedBytes.canSave === false) return { accepted: false as const, reason: "readonly" as const };
      const state = coordinator.getState();
      if (state.state === "saving" || saveAsRequested || saveInProgress) return { accepted: false as const, reason: "saving" as const };
      if (state.state !== "ready" && state.state !== "saved" && state.state !== "dirty") return { accepted: false as const, reason: "blocked" as const };
      const syntheticEdit = state.dirtyGeneration === state.lastSavedGeneration;
      if (syntheticEdit) coordinator.markDirty(state.dirtyGeneration + 1);
      pickerCancelled = false; saveAsRequested = true;
      try {
        const result = await coordinator.save("button");
        if (!pickerCancelled) return result;
        bindCoordinator(state.identity);
        for (const [key, output] of outputs) if (output.saveAs) outputs.delete(key);
        return { accepted: false as const, reason: "cancelled" as const };
      } finally { saveAsRequested = false; }
    },
    async keepDraft(): Promise<boolean> {
      const state = coordinator.getState();
      if (state.state === "ready" || state.state === "saved") return true;
      try { const snapshot = await surface.captureSnapshot(); await draft.checkpoint(snapshot); return true; } catch { return false; }
    },
    async discardDraft(metadata?: DesktopDraftMetadata): Promise<boolean> {
      checkpoint = null;
      const targetId = metadata?.draftId ?? draftIdFor(currentIdentity());
      if (metadata) { const discarded = await discardRow(metadata.draftId, metadata.generation); if (discarded && recoveredRow?.draftId === metadata.draftId) recoveredRow = undefined; return discarded; }
      const known = durableRows.get(targetId);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      if (!row) return known === undefined;
      return discardRow(targetId, row.generation);
    },
    listDrafts: recoverView,
    async recoverDraft(metadata: DesktopDraftMetadata): Promise<PptxDraftRecoverOutcome> {
      try {
        if (openedBytes.canSave === false) return "failed";
        const current = currentIdentity();
        const result = desktopDraftRecoveryResponseSchema.parse(await bridge.call("desktop:draft-recover", { sessionGeneration: SESSION_GENERATION, documentId: identity.documentId, draftId: metadata.draftId, currentBase: { revision: current.baseRevision, version: current.baseVersionId } }));
        if (result.status === "locked") return "locked";
        if (result.status !== "recovered") return "failed";
        const snapshot = JSON.parse(new TextDecoder().decode(decode(result.dataBase64))) as PptxDeckSnapshot;
        await surface.restore(snapshot);
        generationFloor = Math.max(generationFloor, result.metadata.generation);
        durableRows.set(result.metadata.draftId, result.metadata.generation);
        recoveredRow = { draftId: result.metadata.draftId, generation: result.metadata.generation };
        checkpoint = null;
        return "recovered";
      } catch (error) { return (error as { code?: string }).code === "draft_recovery_locked" ? "locked" : "failed"; }
    },
    dispose: () => {
      // Unsubscribe before releasing the engine session: a late coordinator
      // publish must not reach a disposed tab's listeners.
      unsubscribeCoordinator();
      listeners.clear();
      outputs.clear();
      void coordinator.cancel();
      void surface.dispose();
    },
    get snapshotChecksum(): string { return openedBytes.checksum; },
    get localHandle(): string | undefined { return localHandle; },
    get localName(): string | undefined { return localName; },
    get canSave(): boolean { return openedBytes.canSave !== false; },
    get isDisposed(): boolean { return disposed; },
  };
}

export type PptxDocumentSession = ReturnType<typeof createPptxDocumentSession>;
