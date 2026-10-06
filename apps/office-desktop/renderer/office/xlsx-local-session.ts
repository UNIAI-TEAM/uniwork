import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import { createSaveSettleGate } from "@uniwork/core/office";
import type { DraftAdapter, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import { isXlsxWorkbookSnapshot, type XlsxRenderModel, type XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { applyXlsxJournalToSnapshot, createXlsxModelHost, diffXlsxSnapshotsToOperations, isRenderModel, stableJson, type XlsxModelHost, type XlsxOpenOutcome } from "@uniwork/views/office/xlsx";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, desktopDraftRecoveryResponseSchema, desktopDraftResponseSchema, desktopFileResponseSchema, desktopFileXlsxResponseSchema, type DesktopDraftMetadata, type DesktopFileXlsxRequest } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";

const SESSION_GENERATION = "desktop-dev-session";
const ENGINE_BUILD = "xlsx-desktop-local-1";
const CONTRACT_REVISION = "office-editor-host/1";
/** Main's code for a formula-bearing save refused without the recalc sidecar
 *  (main/xlsx-engine.ts; the renderer cannot import main, so it is repeated). */
const RECALC_UNAVAILABLE = "xlsx_recalc_unavailable";

/** The web-compatible render-model reference the shared XlsxEditor reads. */
export type DesktopRenderModelRef = { current: XlsxModelHost | null; listeners: Set<(host: XlsxModelHost | null) => void> };

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function encodeText(value: string): string {
  return encode(new TextEncoder().encode(value));
}

function decodeText(value: string): string {
  return new TextDecoder().decode(decode(value));
}

async function fingerprint(value: XlsxWorkbookSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface DesktopLocalXlsxSessionOptions {
  bridge: LibraryBridge;
  identity: OfficeIdentity;
  title: string;
  canSave: boolean;
  baseRevision: string;
  baseVersionId: string;
  /** The opaque local file handle main owns; the renderer never sees a path. */
  localHandle: string;
}

export interface DesktopLocalXlsxSession {
  readonly format: "xlsx";
  readonly kind: "local";
  readonly editor: import("@uniwork/views/office/xlsx").XlsxEditorHandle<XlsxWorkbookSnapshot>;
  readonly coordinator: ReturnType<typeof createOfficeSaveCoordinator<XlsxWorkbookSnapshot>>;
  readonly open: { open(signal?: AbortSignal): Promise<XlsxOpenOutcome> };
  readonly rendererHostRef: DesktopRenderModelRef;
  readonly capability: { format: "xlsx"; operation: "edit"; host: "desktop"; engineBuild: string; contractRevision: string; status: "available" | "readonly"; fidelityWarnings: string[] };
  readonly documentKey: string;
  readonly canSave: boolean;
  readonly isDisposed: boolean;
  readonly localHandle: string;
  keepDraft(): Promise<boolean>;
  discardDraft(metadata?: DesktopDraftMetadata): Promise<boolean>;
  listDrafts(): Promise<{ metadata: DesktopDraftMetadata; conflict: boolean } | null>;
  recoverDraft(metadata: DesktopDraftMetadata): Promise<"recovered" | "locked" | "failed">;
  dispose(): void;
}

/** Bind the shared XLSX editor to the desktop LOCAL file lane (C1b). Open
 *  reads the workbook through the main-owned `desktop:file-xlsx` job (the
 *  bundled IronCalc sidecar + xlsx gateway in MAIN), edits ride the same job,
 *  and Save writes back to the opaque local handle through the ONE
 *  `desktop:file-save` command. No network is opened and the renderer never
 *  imports main or Node; drafts keep the `local:<device>` namespace main owns. */
export function createDesktopLocalXlsxSession(options: DesktopLocalXlsxSessionOptions): DesktopLocalXlsxSession {
  const identity: OfficeIdentity = { ...options.identity, baseRevision: options.baseRevision, baseVersionId: options.baseVersionId };
  const documentId = identity.documentId;
  let generation = 0;
  let snapshot: XlsxWorkbookSnapshot | null = null;
  let committed: XlsxWorkbookSnapshot | null = null;
  let disposed = false;
  let opening: Promise<void> | null = null;
  let pending: { revision: number; operation: Record<string, unknown> }[] = [];
  let baseRevision = options.baseRevision;
  let baseVersionId = options.baseVersionId;
  let lastCommit: { intentId: string; revision: string } | null = null;
  const candidates = new Map<string, { baseRevision: string; snapshot: XlsxWorkbookSnapshot; operations: Record<string, unknown>[]; output?: { bytes: Uint8Array; checksum: string } }>();
  const rendererHostRef: DesktopRenderModelRef = { current: null, listeners: new Set() };
  const snapshotListeners = new Set<(snapshot: XlsxWorkbookSnapshot) => void>();
  const outputs = new Map<string, { dataBase64: string; sizeBytes: number; checksum: string }>();

  const publishRenderModel = (host: XlsxModelHost | null) => {
    rendererHostRef.current = host;
    for (const listener of rendererHostRef.listeners) listener(host);
  };
  const publishSnapshot = () => {
    if (!snapshot) return;
    const value = structuredClone(snapshot);
    for (const listener of snapshotListeners) listener(value);
  };
  const callJob = async (body: Omit<DesktopFileXlsxRequest, "sessionGeneration" | "handle">) => {
    let raw: unknown;
    try { raw = await options.bridge.call("desktop:file-xlsx", { sessionGeneration: SESSION_GENERATION, handle: options.localHandle, ...body }); }
    catch (error) {
      // Electron's invoke rejection carries only main's message. A build with
      // no recalc sidecar refuses a formula-bearing save with this code; give
      // it back its code so the save banner names it (not office_unknown_error).
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(RECALC_UNAVAILABLE)) throw Object.assign(new Error(RECALC_UNAVAILABLE), { code: RECALC_UNAVAILABLE, errorClass: "engine" });
      throw error;
    }
    const response = desktopFileXlsxResponseSchema.parse(raw);
    if (response.state !== "completed" || response.outputBase64 === undefined) throw new Error(`local_xlsx_job_${response.state}`);
    return response;
  };
  const runOpenJob = async (): Promise<{ snapshot: XlsxWorkbookSnapshot; renderModel: XlsxRenderModel }> => {
    const response = await callJob({ operation: "open", baseRevision });
    let parsed: unknown;
    try { parsed = JSON.parse(decodeText(response.outputBase64!)); } catch { throw new Error("office_open_snapshot_invalid"); }
    const value = parsed && typeof parsed === "object" ? parsed as { snapshot?: unknown; render_model?: unknown } : {};
    if (!isXlsxWorkbookSnapshot(value.snapshot)) throw new Error("office_open_snapshot_invalid");
    if (!isRenderModel(value.render_model)) throw new Error("office_open_render_model_invalid");
    return { snapshot: value.snapshot, renderModel: value.render_model };
  };

  const editor: import("@uniwork/views/office/xlsx").XlsxEditorHandle<XlsxWorkbookSnapshot> = {
    format: "xlsx",
    async open() {
      if (disposed) throw new Error("xlsx_editor_disposed");
      if (snapshot) return;
      opening ??= (async () => {
        const opened = await runOpenJob();
        if (disposed) throw new Error("xlsx_editor_disposed");
        snapshot = structuredClone(opened.snapshot);
        committed = structuredClone(opened.snapshot);
        generation = 0;
        publishRenderModel(opened.renderModel ? createXlsxModelHost(opened.renderModel, { sessionId: documentId, name: options.title, sha256: documentId }) : null);
        publishSnapshot();
      })().catch((error: unknown) => { opening = null; throw error; });
      try { await opening; } finally { opening = null; }
    },
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      if (!snapshot) throw new Error("xlsx_snapshot_unavailable");
      const value = structuredClone(snapshot);
      return { generation, fingerprint: await fingerprint(value), value };
    },
    getWorkbookSnapshot: () => snapshot ? structuredClone(snapshot) : null,
    subscribeSnapshot(listener) { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
    async edit(operations) {
      if (!snapshot) throw new Error("xlsx_editor_not_open");
      const copied = structuredClone(operations) as Record<string, unknown>[];
      snapshot = applyXlsxJournalToSnapshot(snapshot, copied);
      pending.push(...copied.map((operation) => ({ revision: snapshot!.revision, operation })));
      generation += 1;
      publishSnapshot();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      snapshot = null;
      committed = null;
      pending = [];
      candidates.clear();
      publishRenderModel(null);
      snapshotListeners.clear();
    },
  };

  // The local engine job is the serializer: serialize queues the ops the editor
  // applied and returns the produced bytes; commit writes them back to the
  // opaque local handle through the ordinary desktop:file-save command.
  // The draft id binds synchronously inside the gate's write; a snapshot read
  // across a Save (which filters the pending journal) is captured again. The
  // commit marks the rebase once the write is confirmed; a capture parked behind
  // a Save that never answers writes under the pre-save base after the bound.
  const gate = createSaveSettleGate();
  const transport: OfficeSaveTransport<XlsxWorkbookSnapshot> = {
    async serialize({ intent, snapshot: stable }) {
      if (!snapshot || !committed) throw new Error("xlsx_editor_not_open");
      let candidate = candidates.get(intent.intentId);
      if (!candidate) {
        if (stable.value.revision < committed.revision || stable.value.revision > snapshot.revision) throw new Error("xlsx_save_snapshot_invalid");
        const prefix = pending.filter((entry) => entry.revision <= stable.value.revision).map((entry) => entry.operation);
        if (stableJson(applyXlsxJournalToSnapshot(committed, prefix).sheets) !== stableJson(stable.value.sheets)) throw new Error("xlsx_save_snapshot_invalid");
        candidate = { baseRevision, snapshot: structuredClone(stable.value), operations: structuredClone(prefix) };
        candidates.set(intent.intentId, candidate);
      }
      if (candidate.baseRevision !== baseRevision) throw new Error("xlsx_save_base_changed");
      const captured = candidate;
      if (!captured.output) {
        const response = await callJob({ operation: "edit", baseRevision: captured.baseRevision, edits: captured.operations });
        const bytes = decode(response.outputBase64!);
        captured.output = { bytes, checksum: response.outputChecksum ?? `sha256:${await fingerprint(captured.snapshot)}` };
      }
      const output = captured.output;
      outputs.set(intent.intentId, { dataBase64: encode(output.bytes), sizeBytes: output.bytes.byteLength, checksum: output.checksum });
      return { data: output.bytes.slice(), checksumSha256: output.checksum, sizeBytes: output.bytes.byteLength, format: "xlsx" };
    },
    async upload({ intent, output }) {
      return { uploadId: `desktop-local-upload:${intent.intentId}`, checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes, claimExpiresAt: new Date(Date.now() + 120_000).toISOString() };
    },
    async commit({ intent }) {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("desktop save output missing");
      const result = desktopFileResponseSchema.parse(await options.bridge.call("desktop:file-save", { sessionGeneration: SESSION_GENERATION, handle: options.localHandle, dataBase64: output.dataBase64 }));
      if (!result.opened || !result.metadata) throw new Error("save_unconfirmed");
      if (result.metadata.checksum !== output.checksum) throw new Error("local_save_checksum_mismatch");
      gate.markRebase();
      outputs.delete(intent.intentId);
      const candidate = candidates.get(intent.intentId);
      const versionId = result.metadata.checksum;
      // Local revisions are decimal strings; never feed a fractional Windows
      // mtime into BigInt, and never hand the coordinator a non-advancing base.
      const nextRevision = String(Math.trunc(result.metadata.modifiedAtMs));
      if (candidate) { committed = structuredClone(candidate.snapshot); pending = pending.filter((entry) => entry.revision > candidate.snapshot.revision); baseRevision = nextRevision; baseVersionId = versionId; lastCommit = { intentId: intent.intentId, revision: nextRevision }; candidates.clear(); }
      const receiptRevision = BigInt(nextRevision) > BigInt(intent.identity.baseRevision) ? nextRevision : String(BigInt(intent.identity.baseRevision) + 1n);
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId, versionId, revision: receiptRevision, checksumSha256: result.metadata.checksum, sizeBytes: output.sizeBytes, engineName: "genoffice", engineVersion: ENGINE_BUILD, contractVersion: CONTRACT_REVISION, protocolVersion: "1" };
    },
    // Settled without a commit: drop the retained bytes and the frozen candidate.
    async release({ intent }) { outputs.delete(intent.intentId); candidates.delete(intent.intentId); },
    async reconcile() { return null; },
  };

  // Durable drafts cross the same typed IPC seam the docx local host uses; the
  // JSON snapshot is the StableSnapshot the coordinator compares by generation.
  const draftIdFor = (target: OfficeIdentity) => `${target.documentId}:${target.baseVersionId}:${target.baseRevision}`;
  let lastCheckpoint: StableSnapshot<XlsxWorkbookSnapshot> | null = null;
  let pendingIntent: OfficeSaveIntent<XlsxWorkbookSnapshot> | null = null;
  let generationFloor = 0;
  const durableRows = new Map<string, number>();
  const listRows = async (): Promise<readonly DesktopDraftMetadata[] | null> => {
    try { return desktopDraftListResponseSchema.parse(await options.bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION, documentId })).drafts; }
    catch { return null; }
  };
  const discardRow = async (draftId: string, rowGeneration: number): Promise<boolean> => {
    try {
      desktopDraftDiscardResponseSchema.parse(await options.bridge.call("desktop:draft-discard", { sessionGeneration: SESSION_GENERATION, documentId, draftId, generation: Math.max(1, rowGeneration) }));
      durableRows.delete(draftId);
      return true;
    } catch { return false; }
  };
  const writeRow = async (stable: StableSnapshot<XlsxWorkbookSnapshot>, draftId: string): Promise<void> => {
    const rows = await listRows();
    generationFloor = Math.max(generationFloor, ...(rows ?? []).map((row) => row.generation));
    const next = Math.max(1, generationFloor + 1, stable.generation);
    const result = desktopDraftResponseSchema.parse(await options.bridge.call("desktop:draft-checkpoint", { sessionGeneration: SESSION_GENERATION, documentId, draftId, generation: next, dataBase64: encodeText(JSON.stringify(stable)) }));
    lastCheckpoint = stable;
    generationFloor = Math.max(generationFloor, result.generation);
    durableRows.set(draftId, result.generation);
  };
  const draft: DraftAdapter<XlsxWorkbookSnapshot> = {
    checkpoint: () => gate.capture(() => editor.captureSnapshot(), (stable) => {
      if (disposed) throw new Error("xlsx_editor_disposed");
      if (stable.generation <= coordinator.getState().lastSavedGeneration) return undefined;
      return writeRow(stable, draftIdFor(coordinator.getState().identity));
    }),
    recover: async () => lastCheckpoint,
    discard: async (target, savedGeneration) => {
      if (savedGeneration !== undefined && lastCheckpoint && lastCheckpoint.generation > savedGeneration) return;
      const targetId = draftIdFor(target);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      const rowGeneration = row?.generation ?? durableRows.get(targetId);
      if (rowGeneration === undefined) return;
      if (await discardRow(targetId, rowGeneration)) { lastCheckpoint = null; }
    },
    persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent,
    clearIntent: async () => { pendingIntent = null; },
  };

  const coordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport });
  // Saves and reconciles run inside the gate so no checkpoint lands across their rebase.
  const save: typeof coordinator.save = (entryPoint) => gate.run(() => coordinator.save(entryPoint));
  const gatedCoordinator = { ...coordinator, save, retry: () => save("retry"), reconcile: () => gate.run(() => coordinator.reconcile()) };
  if (!options.canSave) coordinator.setCapability({ format: "xlsx", operation: "edit", host: "desktop", engineBuild: ENGINE_BUILD, contractRevision: CONTRACT_REVISION, status: "readonly", fidelityWarnings: [] });

  const open = {
    async open(signal?: AbortSignal): Promise<XlsxOpenOutcome> {
      if (signal?.aborted) return { outcome: "failed", document_id: documentId, format: "xlsx", failure_class: "engine_error", message: "open cancelled" };
      try {
        await editor.open();
        return { outcome: "opened", document_id: documentId, document_model_ref: `desktop:${documentId}`, snapshot: editor.getWorkbookSnapshot?.() ?? undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Main answers engine_incompatible when this build staged no xlsx
        // gateway: not a retryable glitch, so the screen says the engine is
        // missing from the build instead of "cannot open, retry".
        if (/engine_incompatible/.test(message)) return { outcome: "failed", document_id: documentId, format: "xlsx", failure_class: "engine_unavailable", engine_error: "engine_incompatible", message };
        return { outcome: "failed", document_id: documentId, format: "xlsx", failure_class: "engine_error", message };
      }
    },
  };

  const recoverView = async (): Promise<{ metadata: DesktopDraftMetadata; conflict: boolean } | null> => {
    try {
      const listed = desktopDraftListResponseSchema.parse(await options.bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION, documentId }));
      const rows = [...listed.drafts].sort((left, right) => right.updatedAt - left.updatedAt);
      const newest = rows[0];
      if (!newest) return null;
      generationFloor = Math.max(generationFloor, newest.generation);
      for (const row of rows) durableRows.set(row.draftId, row.generation);
      const current = coordinator.getState().identity;
      return { metadata: newest, conflict: newest.identity.base.revision !== current.baseRevision || newest.identity.base.version !== current.baseVersionId };
    } catch { return null; }
  };

  return {
    format: "xlsx",
    kind: "local",
    editor,
    coordinator: gatedCoordinator,
    open,
    rendererHostRef,
    documentKey: documentId,
    capability: { format: "xlsx", operation: "edit", host: "desktop", engineBuild: ENGINE_BUILD, contractRevision: CONTRACT_REVISION, status: options.canSave ? "available" : "readonly", fidelityWarnings: [] },
    async keepDraft(): Promise<boolean> {
      if (disposed || !snapshot) return false;
      const state = coordinator.getState();
      if (state.state === "ready" || state.state === "saved") return true;
      try { await coordinator.checkpoint(); return true; } catch { return false; }
    },
    async discardDraft(metadata?: DesktopDraftMetadata): Promise<boolean> {
      lastCheckpoint = null;
      const targetId = metadata?.draftId ?? draftIdFor(coordinator.getState().identity);
      if (metadata) return discardRow(metadata.draftId, metadata.generation);
      const row = (await listRows())?.find((candidate) => candidate.draftId === targetId);
      if (!row) return durableRows.get(targetId) === undefined;
      return discardRow(targetId, row.generation);
    },
    listDrafts: recoverView,
    async recoverDraft(metadata: DesktopDraftMetadata): Promise<"recovered" | "locked" | "failed"> {
      try {
        if (!options.canSave) return "failed";
        const current = coordinator.getState().identity;
        const result = desktopDraftRecoveryResponseSchema.parse(await options.bridge.call("desktop:draft-recover", { sessionGeneration: SESSION_GENERATION, documentId, draftId: metadata.draftId, currentBase: { revision: current.baseRevision, version: current.baseVersionId } }));
        if (result.status === "locked") return "locked";
        if (result.status !== "recovered") return "failed";
        await editor.open();
        let recovered: XlsxWorkbookSnapshot;
        try { recovered = (JSON.parse(decodeText(result.dataBase64)) as StableSnapshot<XlsxWorkbookSnapshot>).value; } catch { return "failed"; }
        if (!isXlsxWorkbookSnapshot(recovered)) return "failed";
        const operations = diffXlsxSnapshotsToOperations(snapshot ?? recovered, recovered);
        if (operations.length) await editor.edit?.(operations);
        coordinator.markDirty(editor.getDirtyGeneration());
        generationFloor = Math.max(generationFloor, result.metadata.generation);
        durableRows.set(result.metadata.draftId, result.metadata.generation);
        lastCheckpoint = null;
        return "recovered";
      } catch (error) { return (error as { code?: string }).code === "draft_recovery_locked" ? "locked" : "failed"; }
    },
    get canSave(): boolean { return options.canSave; },
    get isDisposed(): boolean { return disposed; },
    get localHandle(): string { return options.localHandle; },
    dispose() { gate.dispose(); void editor.dispose(); },
  };
}

export { diffXlsxSnapshotsToOperations };
