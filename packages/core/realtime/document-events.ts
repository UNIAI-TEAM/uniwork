import { clearDocumentAccessRequestSent } from "../documents/hooks-access-requests";
import { documentKeys } from "../documents/keys";

/**
 * The query keys a `document.*` frame invalidates, or null when the frame is
 * not a document frame. `type` is a plain string: frames arrive untyped on
 * the wire and a deployed client must still invalidate on a catalogue event
 * its WSEventType union predates (ARCHIVE-01: document.shelved/unshelved are
 * added to the union by the server-side worker in parallel). Every document
 * frame is ids-only (ADR 0015): it marks queries stale and nothing from it
 * is cached. Split out of use-realtime-sync (max-lines) when FD-06 wired the
 * three tree frames.
 *
 * `document.access_requested` and `document.access_request_decided` are
 * DOC-07 (UNI-1631): the first refreshes the manager's request list and the
 * share overview, the second refreshes the requester's own document (the
 * locked card watches `detail`) and drops the "sent" device flag (F-08), so a
 * requester who is granted access sees the card clear without a reload.
 */
export function documentFrameKeys(
  wsId: string,
  type: string,
  payload: Record<string, string>,
): (readonly unknown[])[] | null {
  const ownWorkspace = !payload.workspace_id || payload.workspace_id === wsId;
  switch (type) {
    case "document.comment_added":
    case "document.comment_updated":
    case "document.comment_deleted":
    case "document.comment_resolved":
    case "document.comment_unresolved":
    case "document.comment_reaction_added":
    case "document.comment_reaction_removed":
    case "document.comment_anchors_updated": {
      // Comment frames are ids-only and change nothing but the thread (G1-07b
      // owns these keys): invalidate exactly the comment key of the document
      // the frame names, never the document itself - detail, versions and
      // downloadMeta stay fresh. A frame without a document id refreshes
      // nothing, like the other id-addressed cases.
      if (!ownWorkspace || !payload.document_id) return [];
      return [documentKeys.comments(wsId, payload.document_id)];
    }
    case "document.favorited":
    case "document.unfavorited": {
      // A user-scoped bookmark change: the favorites list is organization-
      // scoped (G1-07b) and the frame never names the organization, so the
      // whole small favorites prefix refreshes; the watching workspace's
      // document root refreshes as before.
      return ownWorkspace
        ? [documentKeys.favoritesRoot, documentKeys.workspace(wsId)]
        : [documentKeys.favoritesRoot];
    }
    case "document.created":
    case "document.updated":
    case "document.version_created":
    case "document.shared":
    case "document.share_revoked":
    case "document.workspace_access_changed":
    case "document.link_created":
    case "document.link_revoked":
    case "document.moved":
    case "document.archived":
    case "document.restored":
    case "document.shelved":
    case "document.unshelved": {
      // SH-S1: document.workspace_access_changed (the workspace home row turned
      // on, off or changed level) takes the same refetch a document.updated
      // visibility change always took.
      // Ids-only refetch: the workspace root is the prefix of every document
      // key (list/tree roots, detail, versions, downloadMeta, archive-impact),
      // so one invalidation covers the whole subtree. The frame only marks
      // queries stale; an in-flight draft lives in the save machine, not the
      // cache (documents/save-state.ts keeps it through conflict/unverified).
      // A move, archive, restore, shelve or unshelve by someone else refreshes
      // the tree, the folder content, search results, the shelved list (its key
      // is a workspace-root child) and an open delete dialog's counts.
      return ownWorkspace ? [documentKeys.workspace(wsId)] : [];
    }
    case "document.lock_changed": {
      // UNI-1645: who holds the document changed (acquire, release, expiry,
      // take-over, handover, hold). The R1 state and every row that shows the
      // holder refresh; detail never does - an open editor must not refetch
      // its document because someone started or stopped editing it - and the
      // org-scoped favourites rows carry no lock.
      if (!ownWorkspace || !payload.document_id) return [];
      return [
        documentKeys.editLock(wsId, payload.document_id),
        documentKeys.listRoot(wsId),
        documentKeys.treeRoot(wsId),
        documentKeys.recent(wsId),
        documentKeys.sharedWithMe(wsId),
      ];
    }
    case "document.lock_taken_over":
    case "document.edit_requested":
    case "document.edit_request_answered": {
      // User-scoped lock frames: only the R1 state of that document. The
      // Inbox row they produce arrives as its own notification.created frame.
      if (!ownWorkspace || !payload.document_id) return [];
      return [documentKeys.editLock(wsId, payload.document_id)];
    }
    case "document.access_requested": {
      // DOC-07: someone asked for access, so the manager's pending list and
      // the share overview's count refresh. A frame without a document id, or
      // one stamped for another workspace, refreshes nothing.
      if (!ownWorkspace || !payload.document_id) return [];
      return [
        documentKeys.accessRequests(wsId, payload.document_id),
        documentKeys.shares(wsId, payload.document_id),
      ];
    }
    case "document.access_request_decided": {
      // DOC-07 (F-08): the requester's own request was answered. The locked
      // card follows `detail`, so that key refreshes; the "sent" device flag
      // is dropped so the card stops claiming a request is still waiting.
      // This frame is user-scoped, so it arrives whatever workspace the
      // requester is looking at.
      if (!payload.document_id) return [];
      clearDocumentAccessRequestSent(payload.document_id);
      return [documentKeys.detail(wsId, payload.document_id)];
    }
    default:
      return null;
  }
}
