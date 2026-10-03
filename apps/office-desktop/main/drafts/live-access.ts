import type { DraftIdentity, DraftSession } from "../../../../packages/core/office/draft-recovery";

export type LiveDraftContext = Readonly<{
  kind: "cloud" | "local";
  session: DraftSession;
  identity: DraftIdentity;
}>;

function contextParts(context: LiveDraftContext): readonly (string | number)[] {
  const { session, identity } = context;
  return [context.kind, session.sessionId, session.deploymentId, session.accountId, session.generation,
    identity.deploymentId, identity.accountId, identity.organizationId, identity.workspaceId,
    identity.documentId, identity.base.revision, identity.base.version];
}

function hasSessionScope(context: LiveDraftContext): boolean {
  const { session, identity } = context;
  return Number.isSafeInteger(session.generation) && session.generation > 0 &&
    session.deploymentId === identity.deploymentId && session.accountId === identity.accountId &&
    contextParts(context).every((part) => typeof part === "number" || part.length > 0);
}

/** Recovery authority belongs to the current main-owned session/document and
 * fresh document detail ACL. A successful request for an old context cannot
 * unlock the document selected while that request was pending. */
export function createLiveDraftAccess(options: {
  context(): LiveDraftContext | undefined;
  readAccess?: (scope: { workspaceId: string; documentId: string }) => Promise<"edit" | "none">;
}): () => Promise<"edit" | "none"> {
  return async () => {
    try {
      const current = options.context();
      if (!current || !hasSessionScope(current)) return "none";
      if (current.kind === "local") return "edit";
      if (!options.readAccess) return "none";
      // Capture scalar values, including base/auth generation, before awaiting;
      // retaining the object reference would miss an in-place context mutation.
      const before = contextParts(current);
      const access = await options.readAccess({ workspaceId: current.identity.workspaceId, documentId: current.identity.documentId });
      const after = options.context();
      if (access !== "edit" || !after || !hasSessionScope(after)) return "none";
      const afterParts = contextParts(after);
      return before.every((part, index) => part === afterParts[index]) ? "edit" : "none";
    } catch { return "none"; }
  };
}
