import { paths } from "@uniwork/core/paths";
import type { Notification, Workspace } from "@uniwork/core/types";
import { documentChangedFacts, isDocumentChanged, opensDocumentList } from "./document-changed";

/**
 * The workspace a document notification opens in: the notification's own
 * workspace when the recipient belongs to it, else the open one — a document
 * shared directly opens from any workspace, as the "Shared with me" library
 * does. The push link has no open workspace and falls back further on the server.
 */
function documentWorkspace(n: Notification, workspace: Workspace, workspaces: readonly Workspace[]): Workspace {
  return workspaces.find((w) => w.id === n.workspace_id) ?? workspace;
}

/** Where a click goes, mirroring notification.ResourceURL on the server. */
export function resourceHref(n: Notification, workspace: Workspace, workspaces: readonly Workspace[]): string {
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  switch (n.resource_type) {
    case "task":
      return ws.task(n.resource_id);
    case "meeting":
      // A meeting's batch of assigned tasks lands on the assignee's own
      // tasks: the row carries no task ids, and the meeting's action items
      // are the clerk's review list. The summary kinds land on the summary
      // panel, the transcript kinds on the transcript card
      // (use-meeting-section-deep-link); notification.ResourceURL matches.
      switch (n.kind) {
        case "tasks_assigned":
          return ws.myTasks();
        case "meeting_summary_reminder":
        case "meeting_summary_ready":
          return `${ws.meeting(n.resource_id)}?section=summary`;
        case "meeting_recap_ready":
          return `${ws.meeting(n.resource_id)}?section=${n.params.stage === "minutes" ? "minutes" : "summary"}`;
        case "meeting_transcript_ready":
        case "meeting_transcript_failed":
          return `${ws.meeting(n.resource_id)}?section=transcript`;
        default:
          return ws.meeting(n.resource_id);
      }
    case "audit_export":
      return `${ws.settings()}?tab=audit`;
    case "chat_message": {
      // The message opens in its room, scrolled to it (see use-chat-message-deep-link).
      if (!n.resource_parent_id) return ws.chat();
      const q = new URLSearchParams({ room: n.resource_parent_id, message: n.resource_id });
      return `${ws.chat()}?${q.toString()}`;
    }
    case "document": {
      // The page reveals the comment (use-document-comment-deep-link); an
      // unknown or deleted comment is ignored there, so the id always rides.
      // A discussion post adds its kind: the tab to open when it is gone.
      // A break-glass notification opens the owner access panel directly on the
      // active emergency access section.
      const target = documentWorkspace(n, workspace, workspaces);
      const href = paths.workspace(target.organization_slug, target.slug).document(n.resource_id);
      // The holder's edit request opens the editor with the answer prompt (UNI-1645).
      if (n.kind === "document_edit_requested" && n.params.request_id) {
        return `${href}?${new URLSearchParams({ edit_request: n.params.request_id }).toString()}`;
      }
      // A manager's request row lands on the share dialog's requests section (DOC-07).
      if (n.kind === "document_access_requested") return `${href}?access=requests`;
      if (n.kind === "document_break_glass") return `${href}?access=break_glass`;
      // Somebody else trashed the reader's document: the reader restores it from the trash.
      if (n.kind === "document_trashed_by_other") {
        return paths.workspace(target.organization_slug, target.slug).documentsTrash(n.resource_id);
      }
      if (isDocumentChanged(n)) {
        // Several documents open a list of them: the Inbox opens the dialog for ?notification=<id> (the bell,
        // whose popover closes on open, links there). A row that lists none the reader can read has no list
        // (opensDocumentList) and a trashed document has no page (documentChangedHasPage): the row is inert,
        // and the plain Inbox is the fallback for any other consumer of the link.
        if (documentChangedFacts(n).count > 1) {
          const inbox = paths.workspace(target.organization_slug, target.slug).inbox();
          return opensDocumentList(n) ? `${inbox}?${new URLSearchParams({ notification: n.id }).toString()}` : inbox;
        }
        return href;
      }
      // A body mention (UNI-1968) opens the page on the reader's own mention,
      // which the document reveals itself (useMentionDeepLink); no comment id rides.
      if (n.kind === "document_body_mentioned") return `${href}?mention=1`;
      const commentId = n.params.comment_id;
      if (!commentId) return href;
      const query = new URLSearchParams({ comment: commentId });
      if (n.params.kind === "discussion") query.set("kind", "discussion");
      return `${href}?${query.toString()}`;
    }
    case "chat_room": {
      // A ringing call opens its room, as the push does (notification.ResourceURL).
      const q = new URLSearchParams({ room: n.resource_id });
      return `${ws.chat()}?${q.toString()}`;
    }
    case "email_account":
      return ws.email();
    default:
      return ws.inbox();
  }
}
