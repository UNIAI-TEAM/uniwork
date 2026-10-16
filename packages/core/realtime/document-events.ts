import { documentKeys } from "../documents/keys";
import type { WSEventType } from "../types/events";

/**
 * The query keys a `document.*` frame invalidates, or null when the frame is
 * not a document frame. Every document frame is ids-only (ADR 0015): it marks
 * queries stale and nothing from it is cached. Split out of use-realtime-sync
 * (max-lines) when FD-06 wired the three tree frames.
 */
export function documentFrameKeys(
  wsId: string,
  type: WSEventType,
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
    case "document.restored": {
      // SH-S1: document.workspace_access_changed (the workspace home row turned
      // on, off or changed level) takes the same refetch a document.updated
      // visibility change always took.
      // Ids-only refetch: the workspace root is the prefix of every document
      // key (list/tree roots, detail, versions, downloadMeta, archive-impact),
      // so one invalidation covers the whole subtree. The frame only marks
      // queries stale; an in-flight draft lives in the save machine, not the
      // cache (documents/save-state.ts keeps it through conflict/unverified).
      // A move, archive or restore by someone else refreshes the tree, the
      // folder content, search results and an open delete dialog's counts.
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
    default:
      return null;
  }
}
