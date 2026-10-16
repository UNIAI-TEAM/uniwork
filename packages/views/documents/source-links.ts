import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";

/** The workspace paths a source link needs; `paths.workspace(orgSlug, wsSlug)` satisfies it. */
export interface SourceLinkPaths {
  task: (id: string) => string;
  meeting: (id: string) => string;
  chatConversation: (roomId: string, messageId?: string) => string;
  email: () => string;
}

/** Image extensions the browser draws in the preview when the mime type does not say so. */
const IMAGE_EXTENSIONS: Record<string, true> = { png: true, jpg: true, jpeg: true, gif: true, webp: true, avif: true, bmp: true };

/**
 * What the primary click of a "Từ nơi khác" row does with the file (U-SRC1):
 * an image opens view-only (the blob of the download route, read never
 * written); every other kind downloads. U-SRC1 wants Office formats
 * (docx/xlsx/pptx/pdf/md/html) in the Office viewer — the office-frame API is
 * bound to a saved document's id, so a source file has no view-only frame
 * route yet (UNI-1815 server gap); they download until one lands.
 */
export function sourceOpenAction(source: Pick<DocumentSourceFile, "name" | "mime_type" | "extension">): "image" | "download" {
  if (source.mime_type.toLowerCase().startsWith("image/")) return "image";
  const ext = source.extension.toLowerCase() || source.name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS[ext] === true ? "image" : "download";
}

/**
 * Where "View where attached" leads for a file from another module, built with
 * the workspace paths builders only. A task and a task comment link to the
 * task (a comment attachment's parent id is the task it was posted on); a chat
 * file opens its room (channel, DM or group: the parent id is the room id) at
 * the message it was sent in, falling back to the room when the server named no
 * message; meeting opens by id; email opens the Email Hub, which has no thread
 * route. An unknown parent kind has no link.
 */
export function sourceParentPath(ws: SourceLinkPaths, parent: DocumentSourceFile["parent"]): string | null {
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
