import { listDocumentVersions } from "@uniwork/core/api/endpoints/documents-versions";
import {
  DocsProtocolError,
  isDecimalRevision,
  toProtocolError,
  type ApiOpenPayload,
  type ApiOpenResult,
  type FileMeta,
  type ProtocolErrorShape,
  type RemoteVersionPayload,
  type SaveResult,
} from "@uniwork/core/office/docs-frame-protocol";

/**
 * The host side of "a new version on the web" (EXPERIENCE.md › S6): which head the frame holds,
 * which versions this session committed itself, and when a head read elsewhere is worth a
 * `doc.remoteVersion`. Pure bookkeeping: the realtime/feed wiring that finds heads lives in
 * `use-frame-remote-source.ts`, the endpoint in `use-docs-frame-session.ts`.
 */

/** The document's head as the host read it (session `GET /documents/{id}`). */
export interface RemoteHead {
  /** Decimal string; compared as BigInt, never as text ("9" < "10"). */
  revision: string;
  /** Head version record; null for a document without a file version. */
  versionId: string | null;
  /** ISO 8601 of the head. */
  savedAt: string;
}

/** Why the host refuses every Save of this frame (EXPERIENCE.md › Lý do bị chặn). */
export type FrameBlock = "permission_revoked" | "document_deleted";

/** 403 codes that are their own reasons, not a revoked share (EXPERIENCE.md › reconciling). */
const OWN_REASON_403 = new Set(["organization_suspended", "member_deactivated", "document_archived"]);

/** The error a blocked Save answers: the frame maps 403/410 by code to its bar (B2). */
export function frameBlockError(block: FrameBlock): DocsProtocolError {
  return block === "document_deleted"
    ? new DocsProtocolError({ code: "not_found", message: "the document was deleted", status: 410, details: { apiCode: "document_deleted" } })
    : new DocsProtocolError({ code: "forbidden", message: "access to the document was revoked", status: 403, details: { apiCode: "permission_revoked" } });
}

/**
 * A Save that the server refused for good: 410, or a 403 that is not one of the reasons with
 * their own wording. A refusal made in the host itself (a viewer's write) carries no `apiCode`
 * and blocks nothing.
 */
function blockOfSaveError(error: ProtocolErrorShape): FrameBlock | null {
  if (!error.details || !("apiCode" in error.details)) return null;
  if (error.status === 410) return "document_deleted";
  const apiCode = typeof error.details.apiCode === "string" ? error.details.apiCode : "";
  if (error.status === 403 && !OWN_REASON_403.has(apiCode)) return "permission_revoked";
  return null;
}

/**
 * The verdict of a failed head read (`GET /documents/{id}`): 404/410 is a deleted document, a 403
 * is a lost share unless its code is one of the reasons with their own wording, which the server
 * keeps refusing by itself (the Save path reads them the same way). Anything else (offline, 5xx)
 * is no verdict.
 */
export function blockOfHeadError(status: number, code: string): FrameBlock | null {
  if (status === 404 || status === 410) return "document_deleted";
  if (status === 403 && !OWN_REASON_403.has(code)) return "permission_revoked";
  return null;
}

const asBig = (revision: string | null | undefined): bigint | null => (isDecimalRevision(revision) ? BigInt(revision) : null);

export interface FrameRemoteVersion {
  /** The frame opened these bytes (an `api.open` reply). */
  opened(file: FileMeta): void;
  /** This session committed a version (an `api.save` answer): its own echo never comes back. */
  committed(file: FileMeta, versionId?: string): void;
  /** An `api.save` of this session is in flight: a head read meanwhile may be its own echo. */
  saveStarted(): void;
  saveEnded(): void;
  /** A head read elsewhere; sends `doc.remoteVersion` when it is new to the frame. True = sent. */
  offer(head: RemoteHead): boolean;
  /** A version id this session has seen for the document (opened, committed or announced). */
  knows(versionId: string): boolean;
  block(reason: FrameBlock): void;
  readonly blocked: FrameBlock | null;
  /** The frame now edits another document (save-as): nothing of the old one applies. */
  rebind(documentId: string): void;
}

interface FrameRemoteVersionOptions {
  documentId: string;
  /** `office_sync_feed`, read at the moment of each offer: off = the frame hears nothing. */
  enabled: () => boolean;
  notify: (payload: RemoteVersionPayload) => void;
}

export function createFrameRemoteVersion(options: FrameRemoteVersionOptions): FrameRemoteVersion {
  let documentId = options.documentId;
  let openRevision: bigint | null = null;
  let openVersion: string | null = null;
  let announced: bigint | null = null;
  let own = new Set<string>();
  let known = new Set<string>();
  let saving = 0;
  let deferred: RemoteHead | null = null;
  let blocked: FrameBlock | null = null;

  const hold = (file: FileMeta, versionId?: string) => {
    const revision = asBig(file.revision ?? file.etag);
    // A reply never moves the frame backwards: an older answer that lands late changes nothing.
    if (revision !== null && openRevision !== null && revision < openRevision) return;
    if (revision !== null) openRevision = revision;
    const version = versionId ?? file.versionId ?? null;
    if (version) { openVersion = version; known.add(version); }
  };

  const offer = (head: RemoteHead): boolean => {
    if (!options.enabled() || blocked) return false;
    // Our own commit may land before its answer does: decide once the Save has settled.
    if (saving > 0) {
      if (!deferred || (asBig(head.revision) ?? 0n) > (asBig(deferred.revision) ?? 0n)) deferred = head;
      return false;
    }
    const revision = asBig(head.revision);
    // No version (a page) or a frame that has not opened yet (it opens the head anyway).
    if (revision === null || !head.versionId || openRevision === null) return false;
    if (own.has(head.versionId)) return false;
    if (revision <= openRevision) return false;
    if (announced !== null && revision <= announced) return false;
    // The same bytes under a higher revision: a move, restore, unarchive or rename (OQ-P1,
    // contract-p0 §7.1 option a1, signed 2026-10-12). The server accepts a Save on the old base
    // while the content revision is unchanged, so the frame is told nothing.
    if (head.versionId === openVersion) return false;
    announced = revision;
    known.add(head.versionId);
    options.notify({ document_id: documentId, revision: head.revision, version_id: head.versionId, saved_at: head.savedAt });
    return true;
  };

  return {
    opened: (file) => hold(file),
    committed: (file, versionId) => {
      const version = versionId ?? file.versionId;
      if (version) own.add(version);
      hold(file, versionId);
    },
    saveStarted: () => { saving += 1; },
    saveEnded: () => {
      saving = Math.max(0, saving - 1);
      if (saving > 0 || !deferred) return;
      const head = deferred;
      deferred = null;
      offer(head);
    },
    offer,
    knows: (versionId) => known.has(versionId),
    block: (reason) => { blocked ??= reason; },
    get blocked() { return blocked; },
    rebind: (next) => {
      documentId = next;
      openRevision = null; openVersion = null; announced = null;
      own = new Set(); known = new Set();
      deferred = null; blocked = null;
    },
  };
}

/**
 * `api.save` through the bookkeeping: a blocked frame saves nothing, the answer of a commit is
 * this session's own version, and a refusal for good (410, a revoking 403) blocks the frame.
 */
export function remoteAwareSave<P, C>(
  upload: (payload: P, context: C) => Promise<SaveResult>,
  remote: FrameRemoteVersion,
  onBlock: (reason: FrameBlock) => void,
): (payload: P, context: C) => Promise<SaveResult> {
  return async (payload, context) => {
    if (remote.blocked) throw frameBlockError(remote.blocked);
    remote.saveStarted();
    try {
      const result = await upload(payload, context);
      if (result.ok) remote.committed(result.file, result.versionId);
      else { const block = blockOfSaveError(result.error); if (block) onBlock(block); }
      return result;
    } catch (error) {
      const block = blockOfSaveError(toProtocolError(error).toShape());
      if (block) onBlock(block);
      throw error;
    } finally {
      remote.saveEnded();
    }
  };
}

/** Versions of one document read while looking for an asked `versionId` (pages of the server's default size). */
const VERSION_PAGES = 10;

/** Whether `versionId` is a version of `documentId`, read through the session. Unknown on any failure = false. */
async function versionOfDocument(documentId: string, versionId: string, signal: AbortSignal): Promise<boolean> {
  let cursor: string | undefined;
  for (let page = 0; page < VERSION_PAGES; page += 1) {
    const list = await listDocumentVersions(documentId, cursor ? { cursor } : undefined, signal);
    if (list.versions.some((v) => v.id === versionId && v.document_id === documentId)) return true;
    if (!list.nextCursor) return false;
    cursor = list.nextCursor;
  }
  return false;
}

/**
 * `api.open` with the X-02 / OQ-P3 answer: always the head from one read, `file.revision` filled
 * from that same read (the etag is the document revision), and `versionChanged` when the asked
 * version is an older one of this document. A version this document never had is `not_found`
 * before any bytes move. The head's bytes are never paired with another revision, nor the
 * reverse: the reply is built from one `open` answer only.
 */
export async function openWithRevision(
  open: () => Promise<ApiOpenResult>,
  payload: ApiOpenPayload,
  remote: FrameRemoteVersion,
  signal: AbortSignal,
): Promise<ApiOpenResult> {
  const asked = payload.versionId;
  if (asked && !remote.knows(asked)) {
    const belongs = await versionOfDocument(payload.fileId, asked, signal).catch(() => false);
    if (!belongs) throw new DocsProtocolError({ code: "not_found", message: "that version is not a version of this document", status: 404 });
  }
  const reply = await open();
  const revision = isDecimalRevision(reply.file.revision) ? reply.file.revision : isDecimalRevision(reply.file.etag) ? reply.file.etag : undefined;
  const file: FileMeta = revision ? { ...reply.file, revision } : reply.file;
  remote.opened(file);
  // Only this host decides the flag; whatever the API layer put there is dropped.
  const answer: ApiOpenResult = { ...reply, file };
  delete answer.versionChanged;
  if (asked && revision && file.versionId !== asked) answer.versionChanged = true;
  return answer;
}
