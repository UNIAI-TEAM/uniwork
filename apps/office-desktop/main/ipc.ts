/** Main owns validation/dispatch; the wire schemas live in shared/ so preload
 * can import the contract without importing privileged main-process modules. */
export * from "../shared/ipc";

import type { NativeLoginManager } from "./auth/manager";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema, desktopLibraryResponseSchema, desktopLibraryContextResponseSchema, desktopLibraryDownloadResponseSchema, desktopOfficeOpenResponseSchema, desktopOfficeSaveResponseSchema, type DesktopLibraryResponse, type DesktopLibraryContextResponse, type DesktopLibraryDownloadResponse, type DesktopOfficeOpenResponse, type DesktopOfficeSaveResponse } from "../shared/ipc";
import type { FileHandleRegistry } from "./files/registry";
import { LocalFileError } from "./files/registry";
import type { DesktopDraftStore } from "./drafts/store";
import { DraftRecoveryError, type DraftIdentity, type DraftSession } from "../../../packages/core/office/draft-recovery";
import { getDesktopDiagnostics } from "../shared/identity";
import type { DeploymentProfile } from "../shared/deployment";

/** Main-process transport for cloud Documents and Office operations. The
 * implementation owns the bearer token and is injected by the Electron
 * bootstrap; renderer requests contain only scoped opaque ids and bytes. */
export type DesktopOfficeTransport = Readonly<{
  context(): Promise<DesktopLibraryContextResponse>;
  list(input: { workspaceId: string; cursor?: string; mode: "list" | "recent" | "search"; query?: string }): Promise<DesktopLibraryResponse>;
  download(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopLibraryDownloadResponse>;
  open(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeOpenResponse>;
  save(input: { workspaceId: string; documentId: string; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }): Promise<DesktopOfficeSaveResponse>;
}>;

export interface OfficeIpcOptions {
  readonly transport: DesktopOfficeTransport;
  readonly isSignedIn?: () => boolean;
  readonly onDocumentOpened?: (documentId: string) => void;
}

/** Every cloud call is selected by a fixed channel-to-operation mapping. The
 * dispatcher validates request/response schemas after this function returns;
 * malformed provider answers therefore fail closed at the IPC boundary. */
export function createOfficeIpcHandlers(options: OfficeIpcOptions) {
  const requireSession = () => {
    if (options.isSignedIn && !options.isSignedIn()) throw new OfficeIpcError("login_required");
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
    "desktop:library-recent": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string }>) => {
      requireSession();
      return desktopLibraryResponseSchema.parse(await options.transport.list({ workspaceId: request.workspaceId, cursor: (request as { cursor?: string }).cursor, mode: "recent" }));
    },
    "desktop:library-search": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; query: string }>) => {
      requireSession();
      return desktopLibraryResponseSchema.parse(await options.transport.list({ workspaceId: request.workspaceId, cursor: (request as { cursor?: string }).cursor, mode: "search", query: request.query }));
    },
    "desktop:library-download": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; version?: number }>) => {
      requireSession();
      return desktopLibraryDownloadResponseSchema.parse(await options.transport.download({ workspaceId: request.workspaceId, documentId: request.documentId, version: (request as { version?: number }).version }));
    },
    "desktop:office-open": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; version?: number }>) => {
      requireSession();
      const response = desktopOfficeOpenResponseSchema.parse(await options.transport.open({ workspaceId: request.workspaceId, documentId: request.documentId, version: (request as { version?: number }).version }));
      options.onDocumentOpened?.(request.documentId);
      return response;
    },
    "desktop:office-save": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { workspaceId: string; documentId: string; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }>) => {
      requireSession();
      return desktopOfficeSaveResponseSchema.parse(await options.transport.save(request));
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
}

/** Only handle-based local-file commands are exposed. Picker callbacks run in
 * main and are the sole place a path enters this module. */
export function createFileIpcHandlers(options: FileIpcOptions) {
  return {
    "desktop:file-pick-open": async (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => {
      if (!options.pickOpen) throw new FileIpcError("invalid_path");
      const path = await options.pickOpen();
      if (!path) return { opened: false };
      return { opened: true, metadata: await safeFile(() => options.registry.openPath(path)) };
    },
    "desktop:file-open": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string }>) => ({ opened: true, metadata: await safeFile(() => options.registry.openPathFromHandle(request.handle)) }),
    "desktop:file-save": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => ({ opened: true, metadata: await safeFile(() => options.registry.save(request.handle, decodeBytes(request.dataBase64))) }),
    "desktop:file-save-as": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => {
      if (!options.pickSaveAs) throw new FileIpcError("invalid_path");
      const metadata = await safeFile(() => options.registry.saveAs(request.handle, decodeBytes(request.dataBase64), { pick: options.pickSaveAs! }));
      return { opened: metadata !== undefined, ...(metadata ? { metadata } : {}) };
    },
  };
}

export interface DraftIpcOptions {
  readonly store: DesktopDraftStore;
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
}

/** Checkpoint IPC binds account/deployment/document identity in main. The
 * renderer can provide only a draft id, generation and bytes. */
export function createDraftIpcHandlers(options: DraftIpcOptions) {
  return {
    "desktop:draft-checkpoint": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { draftId: string; generation: number; dataBase64: string }>) => {
      try {
        const metadata = await options.store.checkpointPlaintext({ session: options.session, identity: options.identity, draftId: request.draftId, generation: request.generation, plaintext: decodeBytes(request.dataBase64) });
        return { stored: true, generation: metadata.generation };
      } catch (error) {
        throw new DraftIpcError(error instanceof DraftRecoveryError ? error.code : "storage_unavailable");
      }
    },
  };
}

class FileIpcError extends Error {
  readonly code: string;
  constructor(code: string) { super("local file operation refused"); this.name = "FileIpcError"; this.code = code; }
}

class DraftIpcError extends Error {
  readonly code: string;
  constructor(code: string) { super("draft operation refused"); this.name = "DraftIpcError"; this.code = code; }
}

async function safeFile<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { if (error instanceof LocalFileError) throw new FileIpcError(error.code); throw new FileIpcError("write_failed"); }
}

function decodeBytes(value: string): Uint8Array {
  try { return Uint8Array.from(Buffer.from(value, "base64")); }
  catch { throw new FileIpcError("write_failed"); }
}
