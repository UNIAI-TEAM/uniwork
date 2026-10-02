import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, EditorHandle, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
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

/** Byte-preserving adapter until G3 supplies a content editing surface. It
 * owns the renderer half of the ONE 04b draft store: every checkpoint crosses
 * the typed IPC seam, a confirmed save consumes exactly the committed draft,
 * and a crash recovers only the last confirmed row. */
export function createByteDocumentSession(bridge: LibraryBridge, identity: OfficeIdentity, opened: OpenedBytes) {
  let generation = 0;
  let bytes = decode(opened.dataBase64);
  let checkpoint: StableSnapshot<Uint8Array> | null = null;
  let pendingIntent: OfficeSaveIntent<Uint8Array> | null = null;
  // One draft id per (document, base): a draft for an older base stays a
  // distinct row and is reported as a conflict instead of an ambiguity.
  const draftIdFor = (versionId: string, revision: string) => `${identity.documentId}:${versionId}:${revision}`;
  const currentDraftId = draftIdFor(identity.baseVersionId, identity.baseRevision);
  let generationFloor = 0;
  /** Draft rows this session wrote or read, so discard/commit can name the
   * exact row generation instead of guessing one. */
  const durableRows = new Map<string, number>();

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
      const conflict = newest.identity.base.revision !== identity.baseRevision || newest.identity.base.version !== identity.baseVersionId;
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

  const editor: EditorHandle<Uint8Array> = {
    format: "docx", open: async () => undefined,
    getDirtyGeneration: () => generation,
    captureSnapshot: async () => ({ generation, fingerprint: opened.checksum, checksumSha256: opened.checksum, sizeBytes: bytes.length, value: bytes.slice() }),
    dispose: () => { bytes = new Uint8Array(); checkpoint = null; pendingIntent = null; },
  };
  // Cloud intent memory is session-scoped; the durable checkpoint is written
  // by main (local writes) or by the checkpoint below (cloud drafts).
  const draft: DraftAdapter<Uint8Array> = {
    checkpoint: async (snapshot) => {
      checkpoint = snapshot;
      const rows = await listRows();
      generationFloor = Math.max(generationFloor, ...(rows ?? []).map((row) => row.generation));
      const next = Math.max(1, generationFloor, snapshot.generation);
      const result = desktopDraftResponseSchema.parse(await bridge.call("desktop:draft-checkpoint", { sessionGeneration: SESSION_GENERATION, draftId: currentDraftId, generation: next, dataBase64: encode(snapshot.value) }));
      generationFloor = Math.max(generationFloor, result.generation);
      durableRows.set(currentDraftId, result.generation);
    },
    recover: async () => checkpoint,
    // Commit/discard consume only the committed draft: the row for the base the
    // save landed on is deleted, every other base and the N+1 draft are kept.
    discard: async (target) => {
      checkpoint = null;
      const targetId = draftIdFor(target.baseVersionId, target.baseRevision);
      const known = durableRows.get(targetId);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      const generation = row?.generation ?? known;
      if (generation === undefined) return;
      await discardRow(targetId, generation);
    },
    persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent,
    clearIntent: async () => { pendingIntent = null; },
  };
  const outputs = new Map<string, { dataBase64: string; sizeBytes: number; checksum: string }>();
  const transport: OfficeSaveTransport<Uint8Array> = {
    serialize: async ({ intent, snapshot }) => {
      outputs.set(intent.intentId, { dataBase64: encode(snapshot.value), sizeBytes: snapshot.value.length, checksum: opened.checksum });
      return { data: snapshot.value, sizeBytes: snapshot.value.length, checksumSha256: opened.checksum, format: "docx" };
    },
    upload: async ({ intent, output }) => ({ uploadId: intent.intentId, sizeBytes: output.sizeBytes, checksumSha256: output.checksumSha256, claimExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    commit: async ({ intent }) => {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("snapshot_missing");
      let versionId: string, revision: string, checksum: string;
      if (opened.localHandle) {
        const result = desktopFileResponseSchema.parse(await bridge.call("desktop:file-save", { sessionGeneration: SESSION_GENERATION, handle: opened.localHandle, dataBase64: output.dataBase64 }));
        if (!result.opened || !result.metadata) throw new Error("save_unconfirmed");
        // Local revisions are decimal strings; never feed a non-integer value
        // (a fractional Windows mtime) into BigInt.
        const base = intent.identity.baseRevision;
        versionId = result.metadata.checksum; revision = (/^\d+$/.test(base) ? BigInt(base) + 1n : 1n).toString(); checksum = result.metadata.checksum;
      } else {
        const result = desktopOfficeSaveResponseSchema.parse(await bridge.call("desktop:office-save", { sessionGeneration: SESSION_GENERATION, workspaceId: identity.workspaceId, documentId: identity.documentId, intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, baseVersionId: intent.identity.baseVersionId, baseRevision: intent.identity.baseRevision, dataBase64: output.dataBase64, checksum: output.checksum }));
        versionId = result.versionId; revision = result.revision; checksum = result.checksum;
      }
      outputs.delete(intent.intentId);
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: identity.documentId, versionId, revision, checksumSha256: checksum, sizeBytes: output.sizeBytes, engineName: "docx", engineVersion: "byte-preserving", contractVersion: "office-editor-host/1", protocolVersion: "1" };
    },
    reconcile: async () => null,
  };
  const coordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport });
  if (opened.canSave === false) coordinator.setCapability({ format: "docx", operation: "serialize", host: "desktop", engineBuild: "byte-preserving", contractRevision: "office-editor-host/1", status: "readonly", fidelityWarnings: [] });
  const captured = async (): Promise<StableSnapshot<Uint8Array> | null> => {
    const snapshot = await editor.captureSnapshot();
    return snapshot.generation === editor.getDirtyGeneration() ? snapshot : null;
  };
  return {
    editor,
    coordinator: { ...coordinator, save: async (entryPoint?: Parameters<typeof coordinator.save>[0]) => {
      // Explicit Save may write the opened bytes even before a content edit exists.
      // Never mark dirty during an in-flight Save: the shared coordinator rejects it.
      const state = coordinator.getState();
      if (state.state === "ready" || state.state === "saved") { generation += 1; coordinator.markDirty(generation); }
      return coordinator.save(entryPoint);
    } },
    /** Keep confirms an encrypted checkpoint for the current edits. This is
     * independent of the main process's pre-write protection for local Save. */
    async keepDraft(): Promise<boolean> {
      const state = coordinator.getState();
      if (state.state === "ready" || state.state === "saved") return true;
      const snapshot = await captured();
      if (!snapshot) return false;
      try { await draft.checkpoint(snapshot); return true; } catch { return false; }
    },
    /** Discard consumes the chosen row when the caller names it (a conflict row
     * is stored under its own older-base id) and otherwise the current base row. */
    async discardDraft(metadata?: DesktopDraftMetadata): Promise<boolean> {
      checkpoint = null;
      const targetId = metadata?.draftId ?? currentDraftId;
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
        const result = desktopDraftRecoveryResponseSchema.parse(await bridge.call("desktop:draft-recover", { sessionGeneration: SESSION_GENERATION, draftId: metadata.draftId, currentBase: { revision: identity.baseRevision, version: identity.baseVersionId } }));
        if (result.status !== "recovered") return false;
        bytes = decode(result.dataBase64);
        generation += 1;
        generationFloor = Math.max(generationFloor, result.metadata.generation);
        durableRows.set(result.metadata.draftId, result.metadata.generation);
        checkpoint = null;
        coordinator.markDirty(generation);
        return true;
      } catch { return false; }
    },
    dispose: () => { void editor.dispose(); },
    get snapshotChecksum(): string { return opened.checksum; },
    get localHandle(): string | undefined { return opened.localHandle; },
    get canSave(): boolean { return opened.canSave !== false; },
  };
}

export type ByteDocumentSession = ReturnType<typeof createByteDocumentSession>;
