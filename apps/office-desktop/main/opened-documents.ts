import type { DraftIdentity, DraftSession } from "../../../packages/core/office/draft-recovery";

export interface OpenedDocument {
  readonly documentId: string;
  readonly kind: "local" | "cloud";
  readonly session: DraftSession;
  /** Only `rebase` replaces it, and only with a base main itself observed. */
  identity: DraftIdentity;
  lastConfirmedSaveAt: number;
  pendingCheckpoints: number;
  pendingSaves: number;
  checkpointFailed: boolean;
  checkpointVersion: number;
  savedCheckpointVersion: number;
}

export function sameDocumentSession(a: DraftSession, b: DraftSession): boolean {
  return a.sessionId === b.sessionId && a.generation === b.generation && a.accountId === b.accountId && a.deploymentId === b.deploymentId;
}

/** Only successful main-side opens can introduce an id. Renderer tab updates
 * may select or remove existing contexts, never create a draft identity.
 *
 * Local documents live under the device scope and survive sign-in/sign-out;
 * cloud documents belong to the live account scope and are dropped as soon as
 * that scope changes. */
export function createOpenedDocuments(options: {
  sessionFor(kind: OpenedDocument["kind"]): DraftSession | undefined;
  onClosed?: (documentId: string) => void;
}) {
  const documents = new Map<string, OpenedDocument>();
  let active: string | undefined;

  const stillValid = (document: OpenedDocument): boolean => {
    const scope = options.sessionFor(document.kind);
    return scope !== undefined && sameDocumentSession(document.session, scope) && document.identity.accountId === scope.accountId && document.identity.deploymentId === scope.deploymentId;
  };
  const synchronize = (): void => {
    for (const [id, document] of documents) {
      if (stillValid(document)) continue;
      documents.delete(id);
      options.onClosed?.(id);
    }
    if (active !== undefined && !documents.has(active)) active = undefined;
  };
  const context = (documentId: string): OpenedDocument | undefined => {
    synchronize();
    return documents.get(documentId);
  };
  const opened = (documentId: string, kind: OpenedDocument["kind"], identity: DraftIdentity, session: DraftSession): OpenedDocument => ({ documentId, kind, identity, session, lastConfirmedSaveAt: 0, pendingCheckpoints: 0, pendingSaves: 0, checkpointFailed: false, checkpointVersion: 0, savedCheckpointVersion: 0 });
  return {
    clear() {
      for (const id of documents.keys()) options.onClosed?.(id);
      documents.clear();
      active = undefined;
    },
    synchronize,
    context,
    all(): readonly OpenedDocument[] { synchronize(); return [...documents.values()]; },
    activeDocumentId(): string | undefined { synchronize(); return active; },
    open(documentId: string, kind: OpenedDocument["kind"], identity: DraftIdentity, observed?: DraftSession): boolean {
      synchronize();
      const scope = options.sessionFor(kind);
      if (!scope || !sameDocumentSession(observed ?? scope, scope)) return false;
      if (identity.accountId !== scope.accountId || identity.deploymentId !== scope.deploymentId) return false;
      if (documents.has(documentId)) return true;
      if (documents.size >= 8) return false;
      documents.set(documentId, opened(documentId, kind, identity, scope));
      return true;
    },
    /** Save As replaces an existing local slot, including at the eight-tab cap. */
    rebindLocal(previousId: string, documentId: string, identity: DraftIdentity): boolean {
      const previous = context(previousId);
      const scope = options.sessionFor("local");
      if (!previous || previous.kind !== "local" || previous.pendingSaves > 0 || documents.has(documentId)) return false;
      if (!scope || identity.accountId !== scope.accountId || identity.deploymentId !== scope.deploymentId) return false;
      documents.delete(previousId);
      documents.set(documentId, opened(documentId, "local", identity, scope));
      if (active === previousId) active = documentId;
      options.onClosed?.(previousId);
      return true;
    },
    update(request: { readonly documentIds: readonly string[]; readonly activeDocumentId: string | null }): boolean {
      synchronize();
      const ids = new Set(request.documentIds);
      if (ids.size > 8 || ids.size !== request.documentIds.length || (request.activeDocumentId !== null && !ids.has(request.activeDocumentId))) return false;
      if (request.documentIds.some((id) => !documents.has(id))) return false;
      if ([...documents.values()].some((document) => !ids.has(document.documentId) && document.pendingSaves > 0)) return false;
      for (const id of documents.keys()) if (!ids.has(id)) { documents.delete(id); options.onClosed?.(id); }
      active = request.activeDocumentId ?? undefined;
      return true;
    },
    /** A confirmed local write makes its bytes the base every later draft row is
     * recorded against, so a relaunch (which reads the same bytes back) finds it
     * unchanged. The base comes from main's own write receipt, never from the
     * renderer; the identity otherwise stays exactly as opened. */
    rebase(documentId: string, base: DraftIdentity["base"]): boolean {
      const document = context(documentId);
      if (!document) return false;
      document.identity = { ...document.identity, base };
      return true;
    },
    noteConfirmedSave(documentId: string): void {
      const document = context(documentId);
      if (document) { document.lastConfirmedSaveAt = Date.now(); document.savedCheckpointVersion = document.checkpointVersion; document.checkpointFailed = false; }
    },
    beginSave(documentId: string): (confirmed?: boolean) => void {
      const document = context(documentId);
      const version = document?.checkpointVersion ?? 0;
      if (document) document.pendingSaves += 1;
      let finished = false;
      return (confirmed = true) => {
        if (!document || finished) return;
        finished = true;
        document.pendingSaves -= 1;
        if (!confirmed || context(documentId) !== document) return;
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
