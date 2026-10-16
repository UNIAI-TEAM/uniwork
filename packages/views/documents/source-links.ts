import type { paths } from "@uniwork/core/paths";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";

type WorkspacePaths = ReturnType<typeof paths.workspace>;

/**
 * Where "View where attached" leads for a file from another module, built with
 * the workspace paths builders only. A task and a task comment link to the
 * task (a comment attachment's parent id is the task it was posted on); a chat
 * file opens its room (channel, DM or group: the parent id is the room id) at
 * the message it was sent in, falling back to the room when the server named no
 * message; meeting opens by id; email opens the Email Hub, which has no thread
 * route. An unknown parent kind has no link.
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
      return ws.chatConversation(parent.id, parent.message_id || undefined);
    case "email_thread":
      return ws.email();
    default:
      return null;
  }
}

/**
 * The label of that link: email opens the module only, so it says so instead
 * of promising the origin; everything else says "View where attached".
 */
export function sourceLinkLabelKey(parent: DocumentSourceFile["parent"]): string {
  switch (parent.kind) {
    case "email_thread":
      return "documents.home.row.open_email";
    default:
      return "documents.home.row.go_to_source";
  }
}
