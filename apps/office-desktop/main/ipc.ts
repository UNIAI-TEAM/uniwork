/** Main owns validation/dispatch; the wire schemas live in shared/ so preload
 * can import the contract without importing privileged main-process modules. */
export * from "../shared/ipc";

import type { NativeLoginManager } from "./auth/manager";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema } from "../shared/ipc";
import type { FileHandleRegistry } from "./files/registry";
import { LocalFileError } from "./files/registry";
import type { DesktopDraftStore } from "./drafts/store";
import { DraftRecoveryError, type DraftIdentity, type DraftSession } from "../../../packages/core/office/draft-recovery";
import { getDesktopDiagnostics } from "../shared/identity";
import type { DeploymentProfile } from "../shared/deployment";
import type { OfficeSaveGuard } from "../../../packages/core/office/save-guard";

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
    "desktop:file-save": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => ({ opened: true, metadata: await runGuardedSave(options.saveGuard, () => safeFile(() => options.registry.save(request.handle, decodeBytes(request.dataBase64)))) }),
    "desktop:file-save-as": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { handle: string; dataBase64: string }>) => {
      if (!options.pickSaveAs) throw new FileIpcError("invalid_path");
      const metadata = await runGuardedSave(options.saveGuard, () => safeFile(() => options.registry.saveAs(request.handle, decodeBytes(request.dataBase64), { pick: options.pickSaveAs! })));
      return { opened: metadata !== undefined, ...(metadata ? { metadata } : {}) };
    },
  };
}

async function runGuardedSave<T>(guard: OfficeSaveGuard | undefined, operation: () => Promise<T>): Promise<T> {
  const release = guard?.tryAcquire();
  if (guard && !release) throw new FileIpcError("saving");
  try { return await operation(); }
  finally { release?.(); }
}

export interface DraftIpcOptions {
  readonly store: DesktopDraftStore;
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
  /** The ACL is queried live for every recovery attempt; cached access is not
   * sufficient to unlock an account after logout or revocation. */
  readonly liveAccess?: () => Promise<"edit" | "none">;
  readonly currentBase?: DraftIdentity["base"];
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
    "desktop:draft-list": async (_request: Extract<import("../shared/ipc").DesktopIpcRequest, { sessionGeneration: string }>) => {
      try {
        const drafts = await options.store.list({ session: options.session, lookup: {
          deploymentId: options.identity.deploymentId,
          accountId: options.identity.accountId,
          organizationId: options.identity.organizationId,
          workspaceId: options.identity.workspaceId,
          documentId: options.identity.documentId,
        } });
        return { drafts };
      } catch (error) { throw new DraftIpcError(error instanceof DraftRecoveryError ? error.code : "storage_unavailable"); }
    },
    "desktop:draft-recover": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { draftId: string; currentBase: { revision: string; version: string } }>) => {
      try {
        const currentBase = options.currentBase ?? request.currentBase;
        const liveAccess = await (options.liveAccess?.() ?? Promise.resolve<"edit" | "none">("none"));
        const result = await options.store.recoverPlaintext({
          session: options.session,
          lookup: { deploymentId: options.identity.deploymentId, accountId: options.identity.accountId, organizationId: options.identity.organizationId, workspaceId: options.identity.workspaceId, documentId: options.identity.documentId, draftId: request.draftId },
          currentBase,
          liveAccess,
        });
        return result.status === "recovered" ? { status: result.status, metadata: result.metadata, dataBase64: Buffer.from(result.plaintext).toString("base64") } : result;
      } catch (error) { throw new DraftIpcError(error instanceof DraftRecoveryError ? error.code : "storage_unavailable"); }
    },
    "desktop:draft-discard": async (request: Extract<import("../shared/ipc").DesktopIpcRequest, { draftId: string; generation: number }>) => {
      try {
        await options.store.deleteDurable({ session: options.session, draftId: request.draftId, generation: request.generation });
        return { discarded: true };
      } catch (error) { throw new DraftIpcError(error instanceof DraftRecoveryError ? error.code : "storage_unavailable"); }
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
