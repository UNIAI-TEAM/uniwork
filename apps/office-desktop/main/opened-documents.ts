import type { DraftIdentity, DraftSession } from "../../../packages/core/office/draft-recovery";

export interface OpenedDocument {
  readonly documentId: string;
  readonly kind: "local" | "cloud";
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
  lastConfirmedSaveAt: number;
  pendingCheckpoints: number;
  checkpointFailed: boolean;
  checkpointVersion: number;
  savedCheckpointVersion: number;
}

export function sameDocumentSession(a: DraftSession, b: DraftSession): boolean {
  return a.sessionId === b.sessionId && a.generation === b.generation && a.accountId === b.accountId && a.deploymentId === b.deploymentId;
}

/** Only successful main-side opens can introduce an id. Renderer tab updates
 * may select or remove existing contexts, never create a draft identity. */
export function createOpenedDocuments(options: {
  session(): DraftSession;
  onClosed?: (documentId: string) => void;
}) {
  const documents = new Map<string, OpenedDocument>();
  let boundSession = options.session();
  let active: string | undefined;
  const clear = () => {
    for (const id of documents.keys()) options.onClosed?.(id);
    documents.clear();
    active = undefined;
  };
  const synchronize = () => {
    const live = options.session();
    if (!sameDocumentSession(live, boundSession)) { clear(); boundSession = live; }
    return live;
  };
  const context = (documentId: string): OpenedDocument | undefined => {
    synchronize();
    return documents.get(documentId);
  };
  return {
    clear,
    context,
    all(): readonly OpenedDocument[] { synchronize(); return [...documents.values()]; },
    activeDocumentId(): string | undefined { synchronize(); return active; },
    open(documentId: string, kind: OpenedDocument["kind"], identity: DraftIdentity, session = options.session()): boolean {
      const live = synchronize();
      if (!sameDocumentSession(live, session) || identity.accountId !== live.accountId || identity.deploymentId !== live.deploymentId) return false;
      if (documents.has(documentId)) return true;
      if (documents.size >= 8) return false;
      documents.set(documentId, { documentId, kind, identity, session: live, lastConfirmedSaveAt: 0, pendingCheckpoints: 0, checkpointFailed: false, checkpointVersion: 0, savedCheckpointVersion: 0 });
      return true;
    },
    update(request: { readonly documentIds: readonly string[]; readonly activeDocumentId: string | null }): boolean {
      synchronize();
      const ids = new Set(request.documentIds);
      if (ids.size > 8 || ids.size !== request.documentIds.length || (request.activeDocumentId !== null && !ids.has(request.activeDocumentId))) return false;
      if (request.documentIds.some((id) => !documents.has(id))) return false;
      for (const id of documents.keys()) if (!ids.has(id)) { documents.delete(id); options.onClosed?.(id); }
      active = request.activeDocumentId ?? undefined;
      return true;
    },
    noteConfirmedSave(documentId: string): void {
      const document = context(documentId);
      if (document) { document.lastConfirmedSaveAt = Date.now(); document.savedCheckpointVersion = document.checkpointVersion; document.checkpointFailed = false; }
    },
    beginSave(documentId: string): () => void {
      const document = context(documentId);
      const version = document?.checkpointVersion ?? 0;
      return () => {
        if (!document || context(documentId) !== document) return;
        document.lastConfirmedSaveAt = Date.now();
        document.savedCheckpointVersion = version;
        if (document.checkpointVersion === version) document.checkpointFailed = false;
      };
    },
    beginCheckpoint(documentId: string): (stored: boolean) => void {
      const document = context(documentId);
      if (!document) return () => undefined;
      document.pendingCheckpoints += 1;
      const version = ++document.checkpointVersion;
      return (stored) => {
        document.pendingCheckpoints -= 1;
        if (document.checkpointVersion === version) document.checkpointFailed = !stored;
      };
    },
  };
}

export type OpenedDocuments = ReturnType<typeof createOpenedDocuments>;
