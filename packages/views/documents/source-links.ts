import type { paths } from "@uniwork/core/paths";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";

type WorkspacePaths = ReturnType<typeof paths.workspace>;

/**
 * Where "Go to the original" leads for a file from another module, built with
 * the workspace paths builders only. A task and a task comment link to the
 * task (a comment attachment's parent id is the task it was posted on); chat,
 * meeting and email open their module (meeting by id). An unknown parent kind
 * has no link.
 */
export function sourceParentPath(ws: WorkspacePaths, parent: DocumentSourceFile["parent"]): string | null {
  switch (parent.kind) {
    case "task":
    case "task_comment":
      return ws.task(parent.id);
    case "meeting":
      return ws.meeting(parent.id);
    case "chat_channel":
    case "chat_dm":
      return parent.message_id
        ? ws.chatConversation(parent.id, parent.message_id)
        : ws.chatConversation(parent.id);
    case "email_thread":
      return ws.email();
    default:
      return null;
  }
}

/**
 * The label of that link: chat and email open the module only (there is no
 * per-message route), so they say so instead of promising the original.
 */
export function sourceLinkLabelKey(parent: DocumentSourceFile["parent"]): string {
  switch (parent.kind) {
    case "chat_channel":
    case "chat_dm":
      return parent.message_id ? "documents.home.row.go_to_source" : "documents.home.row.open_chat";
    case "email_thread":
      return "documents.home.row.open_email";
    default:
      return "documents.home.row.go_to_source";
  }
}
