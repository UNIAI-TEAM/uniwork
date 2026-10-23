// Copied from packages/views/chat/chat-file-accept.ts with the document /
// image picker's asset in place of a DOM File; keep in parity
// (file-accept.test.ts). The MIME allowlist matches
// server/internal/service/chat_file_message.go.

/** What the pickers hand back: a name, maybe a MIME type, maybe a size. */
export interface PickedFile {
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/** For expo-document-picker's `type`: the MIME types the server takes. */
export const CHAT_FILE_PICKER_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const ALLOWED_MIME = new Set(CHAT_FILE_PICKER_TYPES);

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".txt", ".docx", ".xlsx"]);

function extensionOf(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? null : lower.slice(dot);
}

export function isChatAcceptedFile(file: PickedFile): boolean {
  if (file.mimeType && ALLOWED_MIME.has(file.mimeType)) return true;
  const ext = extensionOf(file.name);
  return ext !== null && ALLOWED_EXT.has(ext);
}

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/** When the server omits content_type, infer from the filename (legacy rows). */
export function resolveChatFileContentType(file: { content_type?: string; filename?: string }): string | undefined {
  const ct = file.content_type?.trim();
  if (ct) return ct;
  const ext = extensionOf(file.filename ?? "");
  return ext ? EXT_TO_MIME[ext] : undefined;
}

export function isChatImageContentType(contentType: string | undefined, filename?: string): boolean {
  const resolved = contentType?.trim() || (filename ? resolveChatFileContentType({ filename }) : undefined);
  return Boolean(resolved?.startsWith("image/"));
}

/** A picked file (type from the picker, name as fallback). */
export function isChatImageFile(file: PickedFile): boolean {
  return isChatImageContentType(file.mimeType || undefined, file.name);
}

export function isChatPdfContentType(contentType: string | undefined): boolean {
  return contentType === "application/pdf";
}

/** Matches MaxChatFileMessageBytes (25 MiB) in the chat file service. */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const CHAT_FILE_MAX_LABEL = "25 MB";

export function isChatFileTooLarge(file: PickedFile): boolean {
  return (file.size ?? 0) > CHAT_FILE_MAX_BYTES;
}
