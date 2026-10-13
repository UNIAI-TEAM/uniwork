"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@uniwork/core/api/http";
import { listDocumentChanges } from "@uniwork/core/api/endpoints/document-changes";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { useOptionalWS } from "@uniwork/core/realtime";
import type { WSEventType } from "@uniwork/core/types/events";
import type { FrameBlock, FrameRemoteVersion, RemoteHead } from "./frame-remote-version";

/**
 * Where the host learns of a new head for the open document: the realtime `document.*` frames
 * (ids only, UNI-679), and after a reconnect the change feed (G5-02) for whatever the socket
 * missed. Each hint is answered by one session read of the head, so revision, version and time
 * always come from the same answer. Deletion and a lost share block the frame whatever the
 * `office_sync_feed` flag says; only the new-version path follows the flag.
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
  onBlocked: (reason: FrameBlock) => void;
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
        if (error.status === 404 || error.status === 410) latest.current.onBlocked("document_deleted");
        else if (error.status === 403) latest.current.onBlocked("permission_revoked");
        // Anything else (offline, 5xx) is not a verdict: the next frame or reconnect asks again.
      }
    };

    const catchUp = async () => {
      let from = cursor.current?.documentId === documentId ? cursor.current.value : undefined;
      let restarted = false;
      let seen = false;
      for (let page = 0; page < FEED_PAGES && live(); page += 1) {
        let result: Awaited<ReturnType<typeof listDocumentChanges>>;
        try { result = await listDocumentChanges(wsId, from ? { cursor: from } : undefined, abort.signal); } catch { return; }
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
  const blockRef = useRef<FrameBlock | null>(null);
  const [blocked, setBlocked] = useState<FrameBlock | null>(null);
  const applyBlock = useCallback((reason: FrameBlock) => {
    blockRef.current ??= reason;
    remoteRef.current?.block(reason);
    setBlocked(blockRef.current);
  }, []);
  const onHead = useCallback((head: RemoteHead) => { remoteRef.current?.offer(head); }, []);
  useFrameRemoteSource({ wsId, documentId, syncFeed, onHead, onBlocked: applyBlock });
  return { remoteRef, blockRef, blocked, applyBlock };
}
