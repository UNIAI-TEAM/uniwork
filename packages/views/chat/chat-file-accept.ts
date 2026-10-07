/** MIME allowlist matching server/internal/service/chat_file_message.go. */
export const CHAT_FILE_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.docx,.xlsx";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".docx",
  ".xlsx",
]);

export function isChatAcceptedFile(file: File): boolean {
  if (file.type && ALLOWED_MIME.has(file.type)) return true;
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_EXT.has(name.slice(dot));
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
export function resolveChatFileContentType(file: {
  content_type?: string;
  filename?: string;
}): string | undefined {
  const ct = file.content_type?.trim();
  if (ct) return ct;
  const name = file.filename?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXT_TO_MIME[name.slice(dot)];
}

export function isChatImageContentType(contentType: string | undefined, filename?: string): boolean {
  const resolved = contentType?.trim() || (filename ? resolveChatFileContentType({ filename }) : undefined);
  return Boolean(resolved?.startsWith("image/"));
}

/** Local `File` in the composer (type from the picker, name as fallback). */
export function isChatImageFile(file: File): boolean {
  return isChatImageContentType(file.type || undefined, file.name);
}

export function isChatPdfContentType(contentType: string | undefined): boolean {
  return contentType === "application/pdf";
}

export function pickChatAcceptedFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(isChatAcceptedFile);
}
