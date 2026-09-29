/**
 * Host-neutral contract for protected Office draft recovery.
 *
 * The contract deliberately carries ciphertext only. A browser or desktop
 * host owns key acquisition and decryption; this module never accepts a raw
 * key, plaintext fallback, or an account id chosen independently of the
 * authenticated session. The production IndexedDB/OS-backed implementation is
 * intentionally deferred until the G3-D1 decision is approved.
 */

export interface DraftBase {
  /** Documents' logical revision. It is opaque and compared byte-for-byte. */
  readonly revision: string;
  /** The committed object/version id. It is checked together with revision. */
  readonly version: string;
}

/** The complete identity used for namespacing and authenticated data binding. */
export interface DraftIdentity {
  readonly deploymentId: string;
  readonly accountId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly base: DraftBase;
}

/** The session is the only authority for account/deployment scope. */
export interface DraftSession {
  readonly sessionId: string;
  readonly deploymentId: string;
  readonly accountId: string;
  /** Monotonically increasing auth generation; old generations are revoked. */
  readonly generation: number;
}

/** A lookup can omit the base only when the caller intends to handle ambiguity. */
export interface DraftLookup {
  readonly deploymentId: string;
  readonly accountId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly base?: DraftBase;
  readonly draftId?: string;
}

/** A store receives an already encrypted/authenticated snapshot. */
export interface DraftSnapshot {
  readonly draftId: string;
  readonly identity: DraftIdentity;
  readonly generation: number;
  /** Checksum of the ciphertext, not of plaintext. */
  readonly checksum: string;
  readonly ciphertext: Uint8Array;
}

/** Metadata is safe to show in a list. It intentionally has no bytes field. */
export interface DraftMetadata {
  readonly draftId: string;
  readonly identity: DraftIdentity;
  readonly generation: number;
  readonly checksum: string;
  readonly byteLength: number;
  readonly updatedAt: number;
}

export type DraftRecoveryErrorCode =
  | "forbidden"
  | "token_expired"
  | "storage_unavailable"
  | "quota_exceeded"
  | "draft_recovery_locked"
  | "invalid_snapshot"
  | "generation_conflict";

/** Errors are typed so a host can distinguish a locked store from no draft. */
export class DraftRecoveryError extends Error {
  readonly code: DraftRecoveryErrorCode;

  constructor(code: DraftRecoveryErrorCode, message: string) {
    super(message);
    this.name = "DraftRecoveryError";
    this.code = code;
  }
}

export type CheckpointResult =
  | { readonly status: "stored"; readonly metadata: DraftMetadata }
  | { readonly status: "unchanged"; readonly metadata: DraftMetadata };

export type RecoveryResult =
  | {
      readonly status: "recovered";
      readonly metadata: DraftMetadata;
      /** Still encrypted; decryption remains behind the host key boundary. */
      readonly ciphertext: Uint8Array;
    }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly candidates: readonly DraftMetadata[] }
  | {
      readonly status: "conflict";
      readonly metadata: DraftMetadata;
      readonly currentBase: DraftBase;
      readonly draftBase: DraftBase;
    }
  | { readonly status: "blocked"; readonly metadata: DraftMetadata; readonly reason: "edit_acl_missing" }
  | {
      readonly status: "locked";
      readonly metadata?: DraftMetadata;
      readonly code: "draft_recovery_locked";
    };

export interface DraftCheckpointRequest {
  readonly session: DraftSession;
  readonly snapshot: DraftSnapshot;
}

export interface DraftListRequest {
  readonly session: DraftSession;
  readonly lookup?: DraftLookup;
}

export interface DraftRecoveryRequest {
  readonly session: DraftSession;
  readonly lookup: DraftLookup;
  readonly currentBase: DraftBase;
  /** This must be obtained from the live ACL check for this operation. */
  readonly liveAccess: "edit" | "none";
}

export interface DraftDeleteRequest {
  readonly session: DraftSession;
  readonly draftId: string;
  /** Delete is compare-and-delete: never remove a newer generation. */
  readonly generation: number;
}

/**
 * Shared browser/desktop adapter seam.
 *
 * Implementations must make `checkpoint` atomic: a failed write leaves the
 * previous ciphertext and metadata untouched. `clearMemory` only releases
 * decrypted in-memory state and MUST NOT delete durable ciphertext. Durable
 * deletion is explicit and generation-bound (`deleteDurable`).
 */
export interface DraftRecoveryAdapter {
  checkpoint(request: DraftCheckpointRequest): Promise<CheckpointResult>;
  list(request: DraftListRequest): Promise<readonly DraftMetadata[]>;
  recover(request: DraftRecoveryRequest): Promise<RecoveryResult>;
  clearMemory(): Promise<void> | void;
  deleteDurable(request: DraftDeleteRequest): Promise<void>;
}

export function draftNamespace(identity: DraftIdentity): string {
  return [
    identity.deploymentId,
    identity.accountId,
    identity.organizationId,
    identity.workspaceId,
    identity.documentId,
    identity.base.revision,
    identity.base.version,
  ]
    .map(encodeNamespacePart)
    .join("/");
}

function encodeNamespacePart(part: string): string {
  if (part.length === 0) throw new TypeError("draft identity parts must not be empty");
  return encodeURIComponent(part);
}

export function sameBase(left: DraftBase, right: DraftBase): boolean {
  return left.revision === right.revision && left.version === right.version;
}

export function metadataFromSnapshot(snapshot: DraftSnapshot, updatedAt = Date.now()): DraftMetadata {
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) {
    throw new DraftRecoveryError("invalid_snapshot", "draft generation must be a positive safe integer");
  }
  if (snapshot.checksum.length === 0) {
    throw new DraftRecoveryError("invalid_snapshot", "draft checksum must not be empty");
  }
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new DraftRecoveryError("invalid_snapshot", "draft timestamp must be a safe integer");
  }
  return {
    draftId: snapshot.draftId,
    identity: snapshot.identity,
    generation: snapshot.generation,
    checksum: snapshot.checksum,
    byteLength: snapshot.ciphertext.byteLength,
    updatedAt,
  };
}

/** Clone bytes at the boundary so callers cannot mutate a stored snapshot. */
export function cloneCiphertext(ciphertext: Uint8Array): Uint8Array {
  return ciphertext.slice();
}

