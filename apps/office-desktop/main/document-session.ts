import type { createOfficeSaveGuard } from "../../../packages/core/office/save-guard";
import type { DraftIdentity, DraftSession } from "../../../packages/core/office/draft-recovery";
import type { DeploymentProfile } from "../shared/deployment";
import { desktopDocumentFormatForName } from "../shared/document-formats";
import type { NativeLoginManager } from "./auth/manager";
import { createDocumentLeaveEvidence } from "./document-leave";
import { createLiveDraftAccess } from "./drafts/live-access";
import type { createDesktopDraftStore } from "./drafts/store";
import { createProtectedFileCheckpoints, discardProtectedCheckpoint, localDraftBase, localDraftIdentity, type ProtectedCheckpointRef } from "./files/protected-files";
import type { FileHandleRegistry, OpenFileMetadata } from "./files/registry";
import { deviceScopeAccountId, LocalDeviceError } from "./local/device";
import type { createRecentFilesStore } from "./local/recent-files";
import { createOpenedDocuments, sameDocumentSession } from "./opened-documents";
import type { createHttpOfficeTransport } from "./transport/office-transport";

type CloudDocument = { id: string; workspaceId: string; version: number; revision: string };

export type DocumentSessionOptions = {
  sessionGeneration: string;
  deviceId: string | undefined;
  authManager: NativeLoginManager | undefined;
  deploymentProfile: DeploymentProfile | undefined;
  fileRegistry: FileHandleRegistry;
  draftStore: ReturnType<typeof createDesktopDraftStore>;
  recentFiles: ReturnType<typeof createRecentFilesStore> | undefined;
  saveGuard: ReturnType<typeof createOfficeSaveGuard>;
  officeTransport: ReturnType<typeof createHttpOfficeTransport> | undefined;
};

/** Draft scopes and opened-document contexts for the one desktop window: which
 * account or device a document belongs to, and what survives a session change. */
export function createDocumentSession(options: DocumentSessionOptions) {
  const { sessionGeneration, deviceId, authManager, deploymentProfile, fileRegistry, draftStore, recentFiles, officeTransport } = options;
  // Local files always live under the stable `local:<device>` scope so their
  // protected drafts stay device-owned across sign-in and sign-out. Cloud work
  // belongs to the live account scope and is dropped when that scope changes.
  const deviceScope = (): DraftSession => {
    if (!deviceId) throw new LocalDeviceError("unavailable", "local mode is unavailable");
    return { sessionId: sessionGeneration, accountId: deviceScopeAccountId(deviceId), deploymentId: "local-device", generation: 1 };
  };
  const accountScope = (): DraftSession => {
    const metadata = authManager?.getMetadata();
    const deploymentId = deploymentProfile?.deploymentId ?? "local-device";
    const accountId = metadata?.status === "signed-in" && metadata.accountId ? metadata.accountId : "signed-out";
    return { sessionId: sessionGeneration, accountId, deploymentId, generation: authManager?.getGeneration() ?? 1 };
  };
  const protectFile = createProtectedFileCheckpoints({ store: draftStore, scope: deviceScope, identityFor: (handle) => fileRegistry.identityFor(handle) });
  const pendingLocalCheckpoints = new Map<string, ProtectedCheckpointRef>();
  const documents = createOpenedDocuments({ sessionFor: (kind) => kind === "local" ? (deviceId ? deviceScope() : undefined) : accountScope(), onClosed: (id) => {
    fileRegistry.revoke(id);
    pendingLocalCheckpoints.delete(id);
  } });
  const setLocalDocument = (metadata: OpenFileMetadata) => {
    if (documents.open(metadata.handle, "local", localDraftIdentity(deviceScope(), fileRegistry.identityFor(metadata.handle), metadata))) return;
    // A refused open leaves no context behind: release the freshly registered
    // handle instead of leaking it until the window closes.
    fileRegistry.revoke(metadata.handle);
    throw new Error("document_context_refused");
  };
  /** A local open only records the draft context; the durable row is written
   * immediately before a write, so a plain open never offers a draft of the
   * file's own unchanged bytes. Opening also refreshes the encrypted recent list. */
  const localOpenContext = (metadata: OpenFileMetadata) => {
    // A local open outside the shared format table is refused before it can
    // register a context or enter the recent list.
    if (!desktopDocumentFormatForName(metadata.name)) { fileRegistry.revoke(metadata.handle); return; }
    setLocalDocument(metadata);
    const path = fileRegistry.pathOf(metadata.handle);
    if (path && recentFiles) void recentFiles.record({ path, name: metadata.name, modifiedAtMs: metadata.modifiedAtMs }).catch(() => undefined);
  };
  const localCheckpoint = async (metadata: OpenFileMetadata, bytes: Uint8Array) => {
    if (!documents.context(metadata.handle)) throw new Error("document_context_refused");
    pendingLocalCheckpoints.set(metadata.handle, await protectFile(metadata, bytes));
  };
  /** After a confirmed write the pre-write checkpoint is obsolete: consume it so
   * an identical-bytes draft never becomes a stale conflict on the next open. */
  const consumeLocalCheckpoint = (metadata: Pick<OpenFileMetadata, "handle">) => {
    const ref = pendingLocalCheckpoints.get(metadata.handle);
    if (!ref) return;
    pendingLocalCheckpoints.delete(metadata.handle);
    void discardProtectedCheckpoint(draftStore, deviceScope(), ref).catch(() => undefined);
  };
  let documentSession = accountScope();
  const organizationByWorkspace = new Map<string, string>();
  /** Cloud contexts and handles belong only to the current account and session
   * generation; local-device documents and their handles survive both sign-in
   * and sign-out, so only the cloud scope is pruned here. */
  const synchronizeAccount = () => {
    const nextSession = accountScope();
    if (!sameDocumentSession(documentSession, nextSession)) {
      documents.synchronize();
      draftStore.clearMemory();
      organizationByWorkspace.clear();
      documentSession = nextSession;
    }
  };
  // Workspace organization ids come from the authenticated main transport.
  // Browsing the library leaves every open document context intact.
  const cachedOfficeTransport = officeTransport ? { ...officeTransport, context: async () => {
    const session = accountScope();
    const context = await officeTransport.context();
    if (!sameDocumentSession(session, accountScope())) throw new Error("login_required");
    for (const workspace of context.workspaces) if (workspace.organizationId) organizationByWorkspace.set(workspace.id, workspace.organizationId);
    return context;
  } } : undefined;
  const cloudDraftIdentity = (document: CloudDocument): DraftIdentity | undefined => {
    if (!deploymentProfile) return undefined;
    const metadata = authManager?.getMetadata();
    const organizationId = organizationByWorkspace.get(document.workspaceId);
    if (metadata?.status !== "signed-in" || !metadata.accountId || !organizationId) return undefined;
    return { deploymentId: deploymentProfile.deploymentId, accountId: metadata.accountId, organizationId, workspaceId: document.workspaceId, documentId: document.id, base: { version: String(document.version), revision: document.revision } };
  };
  const liveDraftContext = (documentId: string): { session: DraftSession; identity: DraftIdentity } | undefined => documents.context(documentId);
  /** Cloud draft recovery must use a fresh detail ACL, because list summaries
   * deliberately omit my_level. The helper also rejects a tab/session switch
   * while the authenticated detail request is in flight. */
  const liveDraftAccess = (documentId: string): Promise<"edit" | "none"> => createLiveDraftAccess({
    context: () => {
      const active = documents.context(documentId);
      return active ? { kind: active.kind, session: active.session, identity: active.identity } : undefined;
    },
    readAccess: officeTransport?.readDocumentAccess,
  })();
  const noteConfirmedLocalSave = (metadata: OpenFileMetadata) => {
    // The write moved the file: its new bytes are the base later draft rows are
    // recorded against. The protective pre-write row is consumed by its own ref,
    // so rebasing the context does not strand it.
    if (!documents.context(metadata.handle)) setLocalDocument(metadata);
    else documents.rebase(metadata.handle, localDraftBase(metadata));
    consumeLocalCheckpoint(metadata);
  };
  const noteConfirmedLocalRebind = (previousHandle: string, metadata: OpenFileMetadata) => {
    consumeLocalCheckpoint({ handle: previousHandle });
    let rebound = false;
    try { rebound = documents.rebindLocal(previousHandle, metadata.handle, localDraftIdentity(deviceScope(), fileRegistry.identityFor(metadata.handle), metadata)); }
    catch { rebound = false; }
    if (!rebound) {
      // Fail closed: the renderer keeps its old tab identity, so the new
      // handle must not stay reachable in main.
      fileRegistry.revoke(metadata.handle);
      throw new Error("document_context_refused");
    }
    documents.noteConfirmedSave(metadata.handle);
    // The Save As target is a file the user chose to keep: it belongs in the
    // recent list beside every other opened file.
    const path = fileRegistry.pathOf(metadata.handle);
    if (path && recentFiles) void recentFiles.record({ path, name: metadata.name, modifiedAtMs: metadata.modifiedAtMs }).catch(() => undefined);
  };
  const onCloudDocumentOpened = (document: CloudDocument) => {
    const identity = cloudDraftIdentity(document);
    if (!identity || !documents.open(document.id, "cloud", identity)) throw new Error("document_context_refused");
  };
  const leaveEvidence = createDocumentLeaveEvidence({ documents, store: draftStore, saveBusy: () => options.saveGuard.busy });
  return {
    deviceScope,
    accountScope,
    documents,
    localOpenContext,
    localCheckpoint,
    noteConfirmedLocalSave,
    noteConfirmedLocalRebind,
    synchronizeAccount,
    cachedOfficeTransport,
    onCloudDocumentOpened,
    liveDraftContext,
    liveDraftAccess,
    leaveEvidence,
  };
}
