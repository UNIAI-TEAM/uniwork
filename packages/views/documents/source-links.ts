import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { LucideIcon } from "lucide-react";
import { ExternalLink, Mail } from "lucide-react";
import { officeModuleForFormat } from "@uniwork/core/office/office-modules";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";

/** The workspace paths a source link needs; `paths.workspace(orgSlug, wsSlug)` satisfies it. */
export interface SourceLinkPaths {
  task: (id: string) => string;
  meeting: (id: string) => string;
  chatConversation: (roomId: string, messageId?: string) => string;
  email: () => string;
}

/** Image extensions the browser draws in the preview when the mime type does not say so. */
const IMAGE_EXTENSIONS: Record<string, true> = { png: true, jpg: true, jpeg: true, gif: true, webp: true, avif: true, bmp: true };
/** The mime types a browser actually draws; image/tiff, image/heic, image/svg+xml… download instead of showing a broken frame. */
const IMAGE_MIMES: Record<string, true> = { "image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/avif": true, "image/bmp": true };

/**
 * What the primary click of a "Từ nơi khác" row does with the file (U-SRC1,
 * UNI-1869): an image opens view-only in the preview dialog; a file the
 * server marks openable AND a web module exists for opens in its module
 * frame, view-only; every other kind downloads.
 */
export function sourceOpenAction(source: Pick<DocumentSourceFile, "name" | "mime_type" | "extension" | "can_open_in_app">): "image" | "office" | "download" {
  if (IMAGE_MIMES[source.mime_type.toLowerCase()] === true) return "image";
  const ext = source.extension.toLowerCase() || source.name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS[ext] === true) return "image";
  // The server vouches (can_open_in_app) and the client can map a module: the
  // office viewer. A flag on a format this build has no module for still downloads.
  if (source.can_open_in_app && sourceOfficeModule(source) !== null) return "office";
  return "download";
}

const FORMAT_BY_EXTENSION: Record<string, string> = { docx: "docx", xlsx: "xlsx", pptx: "pptx", pdf: "pdf", md: "md", markdown: "md", html: "html", htm: "html" };

/** The `officeModuleForFormat` id of a source file: its extension first, then its mime type (the document host's rule). */
function sourceFormat(source: Pick<DocumentSourceFile, "name" | "mime_type" | "extension">): string {
  const ext = (source.extension.toLowerCase() || source.name.split(".").pop()?.toLowerCase() || "").replace(/^\./, "");
  const byExtension = FORMAT_BY_EXTENSION[ext];
  if (byExtension) return byExtension;
  const mime = source.mime_type.toLowerCase();
  if (mime.includes("wordprocessingml.document")) return "docx";
  if (mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (mime.includes("presentationml.presentation")) return "pptx";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/markdown") return "md";
  if (mime === "text/html") return "html";
  return "unknown";
}

/** The genoffice web module a source file opens in; null when none does (the row downloads). */
export function sourceOfficeModule(source: Pick<DocumentSourceFile, "name" | "mime_type" | "extension">): OfficeModule | null {
  return officeModuleForFormat(sourceFormat(source));
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

/** Whether "View where attached" has a destination at all for this parent kind. */
export function sourceParentLinked(parent: DocumentSourceFile["parent"]): boolean {
  switch (parent.kind) {
    case "task":
    case "task_comment":
    case "meeting":
    case "chat_channel":
    case "chat_dm":
    case "email_thread":
      return true;
    default:
      return false;
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

/**
 * The `aria-label` of the row's secondary button: the visible label plus the
 * file title, so the accessible name contains the label (WCAG 2.5.3) — email
 * keeps its own words instead of "Xem nơi đính kèm".
 */
export function sourceLinkNamedLabelKey(parent: DocumentSourceFile["parent"]): string {
  switch (parent.kind) {
    case "email_thread":
      return "documents.home.row.open_email_named";
    default:
      return "documents.home.row.go_to_source_named";
  }
}

/**
 * The glyph of the row's icon button: email gets the module's Mail glyph
 * (conventions.md §4), every other linked parent the ExternalLink it always had.
 */
export function sourceLinkIcon(parent: DocumentSourceFile["parent"]): LucideIcon {
  switch (parent.kind) {
    case "email_thread":
      return Mail;
    default:
      return ExternalLink;
  }
}
