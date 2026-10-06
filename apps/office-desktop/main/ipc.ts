/** Main owns validation/dispatch; the wire schemas live in shared/ so preload
 * can import the contract without importing privileged main-process modules. */
export * from "../shared/ipc";

import type { NativeLoginManager } from "./auth/manager";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema, desktopLibraryResponseSchema, desktopLibraryContextResponseSchema, desktopPublicConfigResponseSchema, desktopLibraryDownloadResponseSchema, desktopOfficeOpenResponseSchema, desktopOfficeContextResponseSchema, desktopOfficeSaveResponseSchema, desktopOfficeJobResponseSchema, type DesktopLibraryResponse, type DesktopLibraryContextResponse, type DesktopPublicConfigResponse, type DesktopLibraryDownloadResponse, type DesktopOfficeOpenResponse, type DesktopOfficeContextResponse, type DesktopOfficeSaveResponse, type DesktopOfficeJobResponse, type DesktopLibraryCreateResponse, type DesktopFileXlsxResponse } from "../shared/ipc";
import type { FileHandleRegistry } from "./files/registry";
import { LocalFileError } from "./files/registry";
import type { DesktopDraftStore } from "./drafts/store";
import { DraftRecoveryError, type DraftIdentity, type DraftSession } from "../../../packages/core/office/draft-recovery";
import { getDesktopDiagnostics } from "../shared/identity";
import type { DeploymentProfile } from "../shared/deployment";
import type { OfficeSaveGuard } from "../../../packages/core/office/save-guard";
import { sameDocumentSession } from "./opened-documents";
import { blankDocumentBytes, blankDocumentName } from "./files/blank-documents";
import { answerRefusal } from "./files/failure-codes";
import type { LocalModeStore } from "./local/mode";
import type { RecentFilesStore } from "./local/recent-files";
import { LocalDeviceError } from "./local/device";
import { desktopDocumentFormatForName, type DesktopDocumentFormat } from "../shared/document-formats";
import type { LocalXlsxEngine } from "./xlsx-engine";

/** Main-process transport for cloud Documents and Office operations. The
 * implementation owns the bearer token and is injected by the Electron
 * bootstrap; renderer requests contain only scoped opaque ids and bytes. */
export type DesktopOfficeTransport = Readonly<{
  context(): Promise<DesktopLibraryContextResponse>;
  /** Public feature flags (GET /api/v1/config); the renderer gates editors on them. */
  publicConfig(organizationId?: string): Promise<DesktopPublicConfigResponse>;
  list(input: { workspaceId: string; cursor?: string; mode: "list" | "recent" | "search"; query?: string }): Promise<DesktopLibraryResponse>;
  download(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopLibraryDownloadResponse>;
  create(input: { workspaceId: string; title: string; format: DesktopDocumentFormat }): Promise<DesktopLibraryCreateResponse>;
  open(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeOpenResponse>;
  /** Metadata-only open for a carried format whose editor opens through the
   *  server job and never reads raw bytes (xlsx today): it registers the
   *  main-owned document context without downloading the file. */
  openContext(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeContextResponse>;
  /** The server edit/open job for a carried format (xlsx today). The renderer
   *  names the format but never an engine or a grant; main polls and returns
   *  bounded output bytes that then ride the ordinary desktop:office-save
   *  command. */
  officeJob(input: { workspaceId: string; documentId: string; format: DesktopDocumentFormat; operation: "open" | "edit"; baseRevision: string; edits?: readonly unknown[] }): Promise<DesktopOfficeJobResponse>;
  save(input: { workspaceId: string; documentId: string; format: DesktopDocumentFormat; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }): Promise<DesktopOfficeSaveResponse>;
}>;

export interface OfficeIpcOptions {
  readonly transport: DesktopOfficeTransport;
  readonly isSignedIn?: () => boolean;
  readonly session?: () => DraftSession;
  readonly isOpened?: (documentId: string, workspaceId: string) => boolean;
  /** The main-owned draft context follows the opened document (id, workspace,
   * version, revision); the renderer never chooses a draft identity. */
  readonly onDocumentOpened?: (document: { id: string; workspaceId: string; version: number; revision: string }) => void;
  /** One guard shared with local-file and lifecycle Save: a cloud Save in
   * flight blocks every entry point and N+1 is never queued. */
  readonly saveGuard?: OfficeSaveGuard;
  /** Main-observed receipt for the leave decision's save choice. */
  readonly onSaveConfirmed?: (documentId: string) => void;
  readonly beginSave?: (documentId: string) => (confirmed?: boolean) => void;
}

/** Every cloud call is selected by a fixed channel-to-operation mapping. The
 * dispatcher validates request/response schemas after this function returns;
 * malformed provider answers therefore fail closed at the IPC boundary. */
export function createOfficeIpcHandlers(options: OfficeIpcOptions) {
  // Main remembers the format of every document it opened or created; a Save
  // whose declared format disagrees is refused, so the renderer can never
  // upload one format's bytes under another document's media type.
  const formatByDocument = new Map<string, DesktopDocumentFormat>();
  const requireSession = () => {
    if (options.isSignedIn && !options.isSignedIn()) throw new OfficeIpcError("login_required");
  };
  const assertSession = (session: DraftSession | undefined) => {
    requireSession();
    if (session && options.session && !sameDocumentSession(session, options.session())) throw new OfficeIpcError("login_required");
  };
  return {
    "desktop:library-list": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string }>) => {
      requireSession();
      return desktopLibraryResponseSchema.parse(await options.transport.list({ workspaceId: request.workspaceId, cursor: (request as { cursor?: string }).cursor, mode: "list" }));
    },
    "desktop:library-context": async (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => {
      requireSession();
      return desktopLibraryContextResponseSchema.parse(await options.transport.context());
    },
    "desktop:public-config": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:public-config">) => {
      requireSession();
      // A malformed transport answer degrades to no flags (the renderer reads that
      // as engine off and opens cloud documents read-only), never a thrown open.
      const parsed = desktopPublicConfigResponseSchema.safeParse(await options.transport.publicConfig(request.organizationId));
      return parsed.success ? parsed.data : { flags: {} };
    },
    "desktop:library-recent": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string }>) => {
      requireSession();
      return desktopLibraryResponseSchema.parse(await options.transport.list({ workspaceId: request.workspaceId, cursor: (request as { cursor?: string }).cursor, mode: "recent" }));
    },
    "desktop:library-search": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; query: string }>) => {
      requireSession();
      return desktopLibraryResponseSchema.parse(await options.transport.list({ workspaceId: request.workspaceId, cursor: (request as { cursor?: string }).cursor, mode: "search", query: request.query }));
    },
    "desktop:library-create": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; title: string; format: DesktopDocumentFormat }>) => {
      requireSession();
      const session = options.session?.();
      const response = desktopOfficeOpenResponseSchema.parse(await options.transport.create({ workspaceId: request.workspaceId, title: request.title, format: request.format }));
      assertSession(session);
      formatByDocument.set(response.document.id, response.document.format);
      options.onDocumentOpened?.(response.document);
      return response;
    },
    "desktop:library-download": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; version?: number }>) => {
      requireSession();
      return desktopLibraryDownloadResponseSchema.parse(await options.transport.download({ workspaceId: request.workspaceId, documentId: request.documentId, version: (request as { version?: number }).version }));
    },
    "desktop:office-open": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; version?: number }>) => {
      requireSession();
      const session = options.session?.();
      const response = desktopOfficeOpenResponseSchema.parse(await options.transport.open({ workspaceId: request.workspaceId, documentId: request.documentId, version: (request as { version?: number }).version }));
      assertSession(session);
      formatByDocument.set(response.document.id, response.document.format);
      options.onDocumentOpened?.(response.document);
      return response;
    },
    "desktop:office-context": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; version?: number }>) => {
      requireSession();
      const session = options.session?.();
      const response = desktopOfficeContextResponseSchema.parse(await options.transport.openContext({ workspaceId: request.workspaceId, documentId: request.documentId, version: (request as { version?: number }).version }));
      assertSession(session);
      options.onDocumentOpened?.(response.document);
      return response;
    },
    "desktop:office-job": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:office-job">) => {
      requireSession();
      const session = options.session?.();
      // A job may only run for a document this session opened; the renderer
      // cannot mint a job for an arbitrary workspace document.
      if (options.isOpened && !options.isOpened(request.documentId, request.workspaceId)) throw new OfficeIpcError("document_context_refused");
      const response = desktopOfficeJobResponseSchema.parse(await options.transport.officeJob(request));
      assertSession(session);
      return response;
    },
    "desktop:office-save": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; format: DesktopDocumentFormat; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }>) => {
      requireSession();
      const session = options.session?.();
      if (options.isOpened && !options.isOpened(request.documentId, request.workspaceId)) throw new OfficeIpcError("document_context_refused");
      const openedFormat = formatByDocument.get(request.documentId);
      if (openedFormat && openedFormat !== request.format) throw new OfficeIpcError("document_context_refused");
      const release = options.saveGuard?.tryAcquire();
      if (options.saveGuard && !release) throw new OfficeIpcError("saving");
      const confirmSave = options.beginSave?.(request.documentId);
      try {
        const response = desktopOfficeSaveResponseSchema.parse(await options.transport.save(request));
        assertSession(session);
        confirmSave?.();
        options.onSaveConfirmed?.(response.documentId);
        return response;
      }
      finally { confirmSave?.(false); release?.(); }
    },
  };
}

class OfficeIpcError extends Error {
  readonly code: string;
  constructor(code: string) { super("desktop Office operation refused"); this.name = "OfficeIpcError"; this.code = code; }
}

/** Handlers deliberately map the privileged manager to metadata-only values.
 * A token, code, verifier, or state cannot be returned across this boundary. */
export function createAuthIpcHandlers(manager: NativeLoginManager) {
  return {
    "desktop:auth-start": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { clientId: string }>) => {
      if (!manager.isBound(request.clientId, request.deploymentId)) throw new Error("Auth session binding mismatch");
      const result = await manager.startLogin();
      return { status: result.status, attemptId: result.attemptId, expiresAt: result.expiresAt };
    },
    "desktop:auth-cancel": (request: Extract<import("../shared/ipc").DesktopIpcRequest, { attemptId: string }>) => {
      return desktopSessionMetadataSchema.parse(manager.cancelLogin(request.attemptId));
    },
    "desktop:auth-session": (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => desktopSessionMetadataSchema.parse(manager.getMetadata()),
    "desktop:auth-config": (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => desktopAuthConfigResponseSchema.parse(manager.getBinding()),
    "desktop:auth-logout": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { scope: "device" | "family" }>) => desktopSessionMetadataSchema.parse(await manager.logout(request.scope)),
  };
}

/** Diagnostics intentionally expose build/contract identity only.  The
 * session generation is validated by the dispatcher; no document, account,
 * token or path data crosses this narrow read channel. */
export function createDiagnosticsIpcHandler(profile?: DeploymentProfile) {
  return (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => getDesktopDiagnostics(profile);
}

export interface FileIpcOptions {
  readonly registry: FileHandleRegistry;
  readonly pickOpen?: () => Promise<string | undefined>;
  readonly pickSaveAs?: () => Promise<string | undefined>;
  readonly saveGuard?: OfficeSaveGuard;
  readonly session?: () => DraftSession;
  readonly isOpened?: (handle: string) => boolean;
  /** A local open records the live draft context only; no durable row is
   * written until a write is actually at risk. */
  readonly onOpened?: (metadata: import("./files/registry").OpenFileMetadata) => void;
  readonly checkpoint?: (metadata: import("./files/registry").OpenFileMetadata, bytes: Uint8Array) => Promise<void>;
  /** Main-observed receipt for the leave decision's save choice. */
  readonly onSaveConfirmed?: (metadata: import("./files/registry").OpenFileMetadata) => void;
  readonly onSaveAsConfirmed?: (previousHandle: string, metadata: import("./files/registry").OpenFileMetadata) => void;
  readonly beginSave?: (documentId: string) => (confirmed?: boolean) => void;
  /** Main-owned recent list; recent opens resolve an opaque id to a path here. */
  readonly recents?: RecentFilesStore;
  /** Bundled local xlsx engine (C1b). Absent = the local xlsx lane is unbound
   *  and a local .xlsx answers a typed refusal rather than a fake snapshot. */
  readonly xlsx?: LocalXlsxEngine;
}

/** Only handle-based local-file commands are exposed. Picker callbacks run in
 * main and are the sole place a path enters this module. */
export function createFileIpcHandlers(options: FileIpcOptions) {
  const assertSession = (session: DraftSession | undefined) => {
    if (session && options.session && !sameDocumentSession(session, options.session())) throw new FileIpcError("session_revoked");
  };
  const requireOpened = (handle: string) => {
    if (options.isOpened && !options.isOpened(handle)) throw new FileIpcError("invalid_handle");
  };
  const commands = {
    "desktop:file-pick-open": async (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => {
      if (!options.pickOpen) throw new FileIpcError("invalid_path");
      const session = options.session?.();
      const path = await options.pickOpen();
      if (!path) return { opened: false };
      // A pick outside the shared format table is refused here, before any
      // handle, document context or recent row exists.
      if (!desktopDocumentFormatForName(path)) return { opened: false, unsupported: true };
      assertSession(session);
      const metadata = await safeRead(() => options.registry.openPath(path));
      const bytes = await safeRead(() => options.registry.read(metadata.handle));
      assertSession(session);
      options.onOpened?.(metadata);
      return { opened: true, metadata, dataBase64: Buffer.from(bytes).toString("base64") };
    },
    "desktop:file-create": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { format: DesktopDocumentFormat }>) => {
      const session = options.session?.();
      const bytes = blankDocumentBytes(request.format);
      const metadata = await safeFile(async () => options.registry.createUntitled(bytes, blankDocumentName(request.format)));
      assertSession(session);
      options.onOpened?.(metadata);
      return { opened: true, metadata, dataBase64: Buffer.from(bytes).toString("base64") };
    },
    "desktop:recent-open": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:recent-open">) => {
      if (!options.recents) throw new FileIpcError("invalid_path");
      const entry = await options.recents.resolve(request.id);
      if (!entry) return { opened: false, missing: true };
      if (!desktopDocumentFormatForName(entry.path)) return { opened: false, unsupported: true };
      const session = options.session?.();
      let metadata: import("./files/registry").OpenFileMetadata;
      try {
        metadata = await safeRead(() => options.registry.openPath(entry.path));
      } catch (error) {
        // A file removed after the list rendered stays a typed, non-throwing
        // answer so the renderer can show the missing copy.
        if ((error as { code?: string }).code === "not_found") return { opened: false, missing: true };
        throw error;
      }
      const bytes = await safeRead(() => options.registry.read(metadata.handle));
      assertSession(session);
      options.onOpened?.(metadata);
      return { opened: true, metadata, dataBase64: Buffer.from(bytes).toString("base64") };
    },
    "desktop:file-open": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string }>) => {
      const session = options.session?.();
      const metadata = await safeRead(() => options.registry.openPathFromHandle(request.handle));
      const bytes = await safeRead(() => options.registry.read(request.handle));
      assertSession(session);
      options.onOpened?.(metadata);
      return { opened: true, metadata, dataBase64: Buffer.from(bytes).toString("base64") };
    },
    "desktop:file-save": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => runGuardedSave(options.saveGuard, async () => {
      requireOpened(request.handle);
      const session = options.session?.();
      const confirmSave = options.beginSave?.(request.handle);
      try {
        const bytes = decodeBytes(request.dataBase64);
        if (options.checkpoint) {
          const metadata = await safeFile(() => options.registry.openPathFromHandle(request.handle));
          // A draft-store fault is named (file_checkpoint_failed), not left to
          // surface as an unknown error; nothing was written to the file yet.
          try { await options.checkpoint(metadata, bytes); } catch { throw new FileIpcError("checkpoint_failed"); }
        }
        assertSession(session);
        requireOpened(request.handle);
        const metadata = await safeFile(() => options.registry.save(request.handle, bytes));
        assertSession(session);
        options.onSaveConfirmed?.(metadata);
        confirmSave?.();
        return { opened: true, metadata };
      }
      finally { confirmSave?.(false); }
    }),
    "desktop:file-save-as": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => {
      if (!options.pickSaveAs) throw new FileIpcError("invalid_path");
      requireOpened(request.handle);
      const session = options.session?.();
      return runGuardedSave(options.saveGuard, async () => {
        const confirmSave = options.beginSave?.(request.handle);
        try {
          const metadata = await safeFile(() => options.registry.saveAs(request.handle, decodeBytes(request.dataBase64), { pick: async () => {
            const path = await options.pickSaveAs!();
            assertSession(session);
            requireOpened(request.handle);
            return path;
          } }));
          assertSession(session);
          if (metadata) {
            confirmSave?.();
            if (options.onSaveAsConfirmed) options.onSaveAsConfirmed(request.handle, metadata);
            else options.onSaveConfirmed?.(metadata);
          }
          return { opened: metadata !== undefined, ...(metadata ? { metadata } : {}) };
        }
        finally { confirmSave?.(false); }
      });
    },
    // C1b: the local xlsx engine job. The renderer names an opaque handle and
    // a bounded operation; main reads the bytes, drives the bundled gateway +
    // sidecar and returns a bounded snapshot/byte answer. The renderer never
    // reads the file and never names an engine or a path.
    "desktop:file-xlsx": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; operation: "open" | "edit"; baseRevision: string; edits?: readonly Record<string, unknown>[] }>): Promise<DesktopFileXlsxResponse> => {
      requireOpened(request.handle);
      const session = options.session?.();
      if (!options.xlsx) throw new FileIpcError("engine_unavailable");
      const bytes = await safeRead(() => options.registry.read(request.handle));
      // The local xlsx job answers the shared DesktopFileXlsxResponse contract
      // (the same schema the renderer parses), so main and renderer cannot drift.
      if (request.operation === "open") {
        const opened = await options.xlsx.open(bytes);
        assertSession(session);
        return { state: "completed" as const, outputBase64: Buffer.from(JSON.stringify({ snapshot: opened.snapshot, render_model: opened.renderModel })).toString("base64") };
      }
      const result = await options.xlsx.edit(bytes, request.edits ?? []);
      assertSession(session);
      return { state: "completed" as const, outputBase64: Buffer.from(result.bytes).toString("base64"), outputChecksum: result.checksum };
    },
  };
  // A refused file command answers with a typed code instead of throwing: only
  // the message of a thrown Error crosses Electron's invoke, so the code would
  // be lost. Faults that are not file refusals (the xlsx engine) still throw.
  const refused = (code: string) => ({ opened: false as const, code });
  const refuse = <Q, R>(handler: (request: Q) => Promise<R>) => answerRefusal(handler, fileRefusalCode, refused);
  // A Save refused for size keeps its own code: the open-side copy ("too large to
  // open") would mislead, and error-state keeps the draft for it.
  const refuseSave = <Q, R>(handler: (request: Q) => Promise<R>) => answerRefusal(handler, (error) => { const code = fileRefusalCode(error); return code === "too_large" ? "save_too_large" : code; }, refused);
  return {
    "desktop:file-pick-open": refuse(commands["desktop:file-pick-open"]),
    "desktop:file-create": refuse(commands["desktop:file-create"]),
    "desktop:recent-open": refuse(commands["desktop:recent-open"]),
    "desktop:file-open": refuse(commands["desktop:file-open"]),
    "desktop:file-save": refuseSave(commands["desktop:file-save"]),
    "desktop:file-save-as": refuseSave(commands["desktop:file-save-as"]),
    "desktop:file-xlsx": answerRefusal(commands["desktop:file-xlsx"], fileRefusalCode, (code): DesktopFileXlsxResponse => ({ state: "failed", code })),
  };
}

const fileRefusalCode = (error: unknown): string | undefined => (error instanceof FileIpcError ? error.code : undefined);

async function runGuardedSave<T>(guard: OfficeSaveGuard | undefined, operation: () => Promise<T>): Promise<T> {
  const release = guard?.tryAcquire();
  if (guard && !release) throw new FileIpcError("saving");
  try { return await operation(); }
  finally { release?.(); }
}

export interface DraftIpcOptions {
  readonly store: DesktopDraftStore;
  readonly session?: DraftSession;
  readonly identity?: DraftIdentity;
  /** Editor integration supplies a live pair once a document is opened. */
  readonly context?: (documentId: string) => { readonly session: DraftSession; readonly identity: DraftIdentity } | undefined;
  /** Session-only scope used to list an account's drafts before a document is
   * open (app start / restart recovery offer). Rows are filtered by the session. */
  readonly accountSession?: () => DraftSession | undefined;
  /** The local-device scope that replaces an account session when signed out. */
  readonly localSession?: () => DraftSession | undefined;
  readonly beginCheckpoint?: (documentId: string) => (stored: boolean) => void;
  /** The ACL is queried live for every recovery attempt; cached access is not
   * sufficient to unlock an account after logout or revocation. */
  readonly liveAccess?: (documentId: string) => Promise<"edit" | "none">;
  readonly currentBase?: DraftIdentity["base"] | ((documentId: string) => DraftIdentity["base"] | undefined);
}

/** Checkpoint IPC binds account/deployment/document identity in main. The
 * renderer can provide only a draft id, generation and bytes. */
export function createDraftIpcHandlers(options: DraftIpcOptions) {
  const context = (documentId: string): { readonly session: DraftSession; readonly identity: DraftIdentity } => {
    const resolved = options.context ? options.context(documentId) : (options.session && options.identity?.documentId === documentId ? { session: options.session, identity: options.identity } : undefined);
    if (!resolved) throw new DraftIpcError("token_expired");
    if (resolved.identity.accountId !== resolved.session.accountId || resolved.identity.deploymentId !== resolved.session.deploymentId) throw new DraftIpcError("forbidden");
    return resolved;
  };
  const assertCurrent = (documentId: string, previous: ReturnType<typeof context>) => {
    const live = context(documentId);
    if (!sameDocumentSession(live.session, previous.session) || JSON.stringify(live.identity) !== JSON.stringify(previous.identity)) throw new DraftIpcError("token_expired");
  };
  const resolveCurrentBase = (documentId: string, current: { readonly identity: DraftIdentity }): DraftIdentity["base"] => {
    const configured = typeof options.currentBase === "function" ? options.currentBase(documentId) : options.currentBase;
    return configured ?? current.identity.base;
  };
  const translateDraftError = (error: unknown): never => {
    // A typed refusal from this boundary (no live session, malformed payload)
    // must keep its own code instead of being flattened into storage failure.
    if (error instanceof DraftIpcError) throw error;
    throw new DraftIpcError(error instanceof DraftRecoveryError ? error.code : "storage_unavailable");
  };
  return {
    "desktop:draft-checkpoint": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { draftId: string; generation: number; dataBase64: string }>) => {
      let finish: ((stored: boolean) => void) | undefined;
      try {
        const current = context(request.documentId);
        finish = options.beginCheckpoint?.(request.documentId);
        const metadata = await options.store.checkpointPlaintext({ session: current.session, identity: current.identity, draftId: request.draftId, generation: request.generation, plaintext: decodeBytes(request.dataBase64) });
        assertCurrent(request.documentId, current);
        finish?.(true);
        return { stored: true, generation: metadata.generation };
      } catch (error) {
        finish?.(false);
        translateDraftError(error);
      }
    },
    "desktop:draft-list": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:draft-list">) => {
      try {
        const current = request.documentId === undefined ? undefined : context(request.documentId);
        if (!current) {
          // No document is open yet: offer this scope's drafts (metadata only)
          // so a restart can surface recovery. The session, not the renderer,
          // decides which rows are visible; signed out this is the device scope.
          const session = options.accountSession?.() ?? options.localSession?.();
          if (!session) throw new DraftIpcError("token_expired");
          const drafts = (await options.store.list({ session })).filter((draft) => draft.identity.accountId === session.accountId && draft.identity.deploymentId === session.deploymentId);
          const live = options.accountSession?.() ?? options.localSession?.();
          if (!live || !sameDocumentSession(live, session)) throw new DraftIpcError("token_expired");
          return { drafts };
        }
        const drafts = await options.store.list({ session: current.session, lookup: {
          deploymentId: current.identity.deploymentId,
          accountId: current.identity.accountId,
          organizationId: current.identity.organizationId,
          workspaceId: current.identity.workspaceId,
          documentId: current.identity.documentId,
        } });
        assertCurrent(request.documentId!, current);
        return { drafts };
      } catch (error) {
        // The locked state is a reasoned answer, not a transport failure: the
        // renderer shows the locked notice from this typed result.
        if (error instanceof DraftRecoveryError && error.code === "draft_recovery_locked") return { drafts: [], locked: true };
        translateDraftError(error);
      }
    },
    "desktop:draft-recover": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { draftId: string; currentBase: { revision: string; version: string } }>) => {
      try {
        const current = context(request.documentId);
        const currentBase = resolveCurrentBase(request.documentId, current);
        const liveAccess = await (options.liveAccess?.(request.documentId) ?? Promise.resolve<"edit" | "none">("none"));
        assertCurrent(request.documentId, current);
        const result = await options.store.recoverPlaintext({
          session: current.session,
          // The base is deliberately NOT part of the lookup: a draft for a
          // changed base must surface as an explicit conflict, not as missing.
          lookup: { deploymentId: current.identity.deploymentId, accountId: current.identity.accountId, organizationId: current.identity.organizationId, workspaceId: current.identity.workspaceId, documentId: current.identity.documentId, draftId: request.draftId },
          currentBase,
          liveAccess,
        });
        assertCurrent(request.documentId, current);
        return result.status === "recovered" ? { status: result.status, metadata: result.metadata, dataBase64: Buffer.from(result.plaintext).toString("base64") } : result;
      } catch (error) { translateDraftError(error); }
    },
    "desktop:draft-discard": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:draft-discard">) => {
      try {
        const current = request.documentId === undefined ? undefined : context(request.documentId);
        // A discard may also come from the scope-level offer, where no document
        // is open: the live account (or local device) session is then the only scope.
        const session = current?.session ?? options.accountSession?.() ?? options.localSession?.();
        if (!session) throw new DraftIpcError("token_expired");
        // Bind the row to the live scope before deleting: a draft id alone must
        // never let one document (or account) consume another's row.
        const row = (await options.store.list({ session })).find((candidate) => candidate.draftId === request.draftId);
        if (current) assertCurrent(request.documentId!, current);
        else {
          const live = options.accountSession?.() ?? options.localSession?.();
          if (!live || !sameDocumentSession(live, session)) throw new DraftIpcError("token_expired");
        }
        if (!row) return { discarded: true };
        if (row.identity.accountId !== session.accountId || row.identity.deploymentId !== session.deploymentId) throw new DraftIpcError("forbidden");
        if (current && (row.identity.documentId !== current.identity.documentId || row.identity.workspaceId !== current.identity.workspaceId || row.identity.organizationId !== current.identity.organizationId)) throw new DraftIpcError("forbidden");
        await options.store.deleteDurable({ session, draftId: request.draftId, generation: request.generation });
        return { discarded: true };
      } catch (error) { translateDraftError(error); }
    },
  };
}

class FileIpcError extends Error {
  readonly code: string;
  constructor(code: string) { super("local file operation refused"); this.name = "FileIpcError"; this.code = code; }
}

export interface LocalIpcOptions {
  readonly mode: LocalModeStore;
  /** Absent while the device record is unusable: local mode is unavailable. */
  readonly recents?: RecentFilesStore;
}

/** Local-mode state and the encrypted recent-file list. Both are device-owned
 * and expose no path: recent rows carry an opaque id and a display directory. */
export function createLocalIpcHandlers(options: LocalIpcOptions) {
  const requireRecents = (): RecentFilesStore => {
    if (!options.recents) throw new LocalDeviceError("unavailable", "local mode is unavailable");
    return options.recents;
  };
  return {
    "desktop:local-state": () => ({ localMode: options.mode.get() }),
    "desktop:local-mode": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:local-mode">) => ({ localMode: await options.mode.set(request.local) }),
    "desktop:recent-list": async () => ({ files: await requireRecents().list() }),
    "desktop:recent-remove": async (request: import("../shared/ipc").DesktopIpcRequest<"desktop:recent-remove">) => ({ removed: await requireRecents().remove(request.id) }),
  };
}

class DraftIpcError extends Error {
  readonly code: string;
  constructor(code: string) { super("draft operation refused"); this.name = "DraftIpcError"; this.code = code; }
}

/** `fallback` names an unexpected fault: a read-side call says read_failed, so an
 * unreadable file is never reported as a write problem (or as "not found"). */
async function safeFile<T>(operation: () => Promise<T>, fallback: "read_failed" | "write_failed" = "write_failed"): Promise<T> {
  try { return await operation(); }
  catch (error) { if (error instanceof LocalFileError) throw new FileIpcError(error.code); throw new FileIpcError(fallback); }
}
const safeRead = <T>(operation: () => Promise<T>): Promise<T> => safeFile(operation, "read_failed");

function decodeBytes(value: string): Uint8Array {
  try { return Uint8Array.from(Buffer.from(value, "base64")); }
  catch { throw new FileIpcError("write_failed"); }
}
