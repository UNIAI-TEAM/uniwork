"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@uniwork/core/api/http";
import { listDocumentChanges } from "@uniwork/core/api/endpoints/document-changes";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { useOptionalWS } from "@uniwork/core/realtime";
import type { DocBlockedReason } from "@uniwork/core/office/docs-frame-protocol";
import type { WSEventType } from "@uniwork/core/types/events";
import { blockOfHeadError, type FrameBlock, type FrameRemoteVersion, type RemoteHead } from "./frame-remote-version";

/**
 * Where the host learns of a new head for the open document: the realtime `document.*` frames
 * (ids only, UNI-679), and after a reconnect the change feed (G5-02) for whatever the socket
 * missed. Each hint is answered by one session read of the head, so revision, version and time
 * always come from the same answer. Deletion and a lost share block the frame whatever the
 * `office_sync_feed` flag says (EXPERIENCE.md › sync_feed: the flag turns off S6 news, not the S11
 * lock): the realtime frames always run, only the new-version path and the feed follow the flag.
 */

/** Frames whose document may have a new head (a new version, or a metadata-only bump). */
const HEAD_EVENTS: readonly WSEventType[] = ["document.version_created", "document.updated", "document.moved", "document.restored"];
/** Feed pages read per catch-up; a workspace beyond that is caught up on the next reconnect. */
const FEED_PAGES = 50;

interface FrameRemoteSourceOptions {
  wsId: string;
  /** The document the frame edits (the copy after a save-as). */
  documentId: string;
  /** `office_sync_feed`: off = no head reads for new versions and no feed. */
  syncFeed: boolean;
  onHead: (head: RemoteHead) => void;
  onBlocked: (reason: DocBlockedReason) => void;
}

const documentOf = (payload: unknown): string | null =>
  typeof payload === "object" && payload !== null && typeof (payload as { document_id?: unknown }).document_id === "string"
    ? (payload as { document_id: string }).document_id
    : null;

function useFrameRemoteSource({ wsId, documentId, syncFeed, onHead, onBlocked }: FrameRemoteSourceOptions): void {
  const client = useOptionalWS()?.client ?? null;
  const latest = useRef({ onHead, onBlocked });
  latest.current = { onHead, onBlocked };
  // The feed cursor survives reconnects of this document's session; a new document starts cold.
  const cursor = useRef<{ documentId: string; value: string } | null>(null);

  useEffect(() => {
    if (!client || !documentId) return;
    const abort = new AbortController();
    const live = () => !abort.signal.aborted;

    const readHead = async () => {
      try {
        const doc = await getDocument(documentId, abort.signal);
        if (!doc || !live()) return;
        latest.current.onHead({ revision: doc.revision, versionId: doc.file?.version_id ?? null, savedAt: doc.updated_at || new Date().toISOString() });
      } catch (error) {
        if (!live() || !(error instanceof ApiError)) return;
        // Anything else (offline, 5xx) is not a verdict: the next frame or reconnect asks again.
        const block = blockOfHeadError(error.status, error.code);
        if (block) latest.current.onBlocked(block);
      }
    };

    const catchUp = async () => {
      let from = cursor.current?.documentId === documentId ? cursor.current.value : undefined;
      let restarted = false;
      let seen = false;
      for (let page = 0; page < FEED_PAGES && live(); page += 1) {
        let result: Awaited<ReturnType<typeof listDocumentChanges>>;
        try { result = await listDocumentChanges(wsId, from ? { cursor: from } : undefined, abort.signal); } catch (error) {
          // The feed refusing this viewer (403/404) may mean the document went with it: the head read decides.
          if (live() && error instanceof ApiError && (error.status === 403 || error.status === 404)) await readHead();
          return;
        }
        if (!live()) return;
        if (result.kind === "unavailable") return;
        if (result.kind === "resync") {
          // Start once from a snapshot; a second resync in one catch-up waits for the next reconnect.
          if (restarted) return;
          restarted = true; from = undefined; cursor.current = null;
          continue;
        }
        if (result.page.changes.some((c) => c.documentId === documentId)) seen = true;
        from = result.page.nextCursor;
        cursor.current = { documentId, value: from };
        if (!result.page.hasMore) break;
      }
      if (seen && live()) await readHead();
    };

    const onFrame = (payload: unknown) => {
      if (documentOf(payload) !== documentId) return;
      if (syncFeed) void readHead();
    };
    const offs = [
      ...HEAD_EVENTS.map((event) => client.on(event, onFrame)),
      client.on("document.deleted", (payload) => { if (documentOf(payload) === documentId) latest.current.onBlocked("document_deleted"); }),
      // A revoked share says nothing of who lost access: the head read answers 403 for them only.
      client.on("document.share_revoked", (payload) => { if (documentOf(payload) === documentId) void readHead(); }),
      client.onReconnect(() => { if (syncFeed) void catchUp(); }),
    ];
    return () => { abort.abort(); for (const off of offs) off(); };
  }, [client, documentId, syncFeed, wsId]);
}

/**
 * The session's side of the remote-version wiring: the current endpoint's bookkeeping (set by
 * the session effect), and the block, which outlives a retry of the same document.
 */
export function useFrameRemote(wsId: string, documentId: string, syncFeed: boolean) {
  const remoteRef = useRef<FrameRemoteVersion | null>(null);
  // Every reason heard, in order, so the endpoint of a retry is blocked the same way.
  const blockRef = useRef<DocBlockedReason[]>([]);
  const [blocked, setBlocked] = useState<FrameBlock | null>(null);
  const applyBlock = useCallback((reason: DocBlockedReason) => {
    if (!blockRef.current.includes(reason)) blockRef.current = [...blockRef.current, reason];
    remoteRef.current?.block(reason);
    // A delete is final; the reasons with their own wording refuse no Save here.
    if (reason === "permission_revoked" || reason === "document_deleted") setBlocked((now) => (now === "document_deleted" ? now : reason));
  }, []);
  const onHead = useCallback((head: RemoteHead) => { remoteRef.current?.offer(head); }, []);
  useFrameRemoteSource({ wsId, documentId, syncFeed, onHead, onBlocked: applyBlock });
  return { remoteRef, blockRef, blocked, applyBlock };
}
