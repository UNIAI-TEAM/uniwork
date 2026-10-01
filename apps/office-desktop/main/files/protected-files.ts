import { createHash } from "node:crypto";
import type { DraftIdentity } from "../../../../packages/core/office/draft-recovery";
import type { DesktopDraftStore } from "../drafts/store";
import type { OpenFileMetadata } from "./registry";

export interface ProtectedFileScope {
  /** The one live desktop session id; a logout revokes local and cloud writes alike. */
  readonly sessionId: string;
  readonly accountId: string;
  readonly deploymentId: string;
  readonly generation: number;
}

export interface ProtectedCheckpointRef {
  readonly draftId: string;
  readonly generation: number;
}

/** One stable local identity for a file: the caller supplies an opaque id
 * (a path hash) so the raw path never enters the draft envelope. */
export function localDraftIdentity(scope: ProtectedFileScope, stableId: string, metadata: OpenFileMetadata): DraftIdentity {
  return {
    accountId: scope.accountId,
    deploymentId: scope.deploymentId,
    organizationId: "local",
    workspaceId: "local",
    documentId: stableId,
    base: { version: metadata.checksum, revision: String(metadata.modifiedAtMs) },
  };
}

/** Adapt the accepted encrypted draft store so a local file snapshot is a row
 * in the ONE protected store, under a local identity namespace. Cloud drafts
 * and local checkpoints therefore share one store and one OS key store, and a
 * single restart checkpoint flushes both.
 *
 * The caller checkpoints only immediately before a write: the row protects the
 * bytes a failed write would otherwise lose, and `discard` removes it once the
 * write is confirmed. An open with no pending write never creates a row, so a
 * plain open never offers an identical-bytes draft for recovery. */
export function createProtectedFileCheckpoints(options: {
  readonly store: DesktopDraftStore;
  readonly scope: () => ProtectedFileScope;
  /** Restart-stable, path-free identity for the opened handle. */
  readonly identityFor: (handle: string) => string;
}) {
  return async (metadata: OpenFileMetadata, bytes: Uint8Array): Promise<ProtectedCheckpointRef> => {
    const current = options.scope();
    const stableId = options.identityFor(metadata.handle);
    const identity = localDraftIdentity(current, stableId, metadata);
    // One draft id per (file, base) so a draft for an older file state is a
    // distinct record: recovering it reports a conflict instead of becoming
    // ambiguous with the draft of the current state.
    const baseFingerprint = createHash("sha256").update(`${identity.base.version}:${identity.base.revision}`).digest("hex").slice(0, 16);
    const draftId = `${stableId}:${baseFingerprint}`;
    const session = { sessionId: current.sessionId, accountId: current.accountId, deploymentId: current.deploymentId, generation: current.generation };
    // The generation floor is read from the durable row, so a restart or a
    // second process cannot regress a confirmed local checkpoint.
    const existing = await options.store.list({ session, lookup: { deploymentId: identity.deploymentId, accountId: identity.accountId, organizationId: identity.organizationId, workspaceId: identity.workspaceId, documentId: identity.documentId, base: identity.base } });
    const generation = Math.max(0, ...existing.map((row) => row.generation)) + 1;
    await options.store.checkpointPlaintext({ session, identity, draftId, generation, plaintext: bytes });
    return { draftId, generation };
  };
}

/** Consume exactly the checkpoint a confirmed local write superseded. */
export async function discardProtectedCheckpoint(store: DesktopDraftStore, scope: ProtectedFileScope, ref: ProtectedCheckpointRef): Promise<void> {
  const session = { sessionId: scope.sessionId, accountId: scope.accountId, deploymentId: scope.deploymentId, generation: scope.generation };
  await store.deleteDurable({ session, draftId: ref.draftId, generation: ref.generation });
}
