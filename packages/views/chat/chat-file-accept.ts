/** MIME allowlist matching server/internal/service/chat_file_message.go. */
export const CHAT_FILE_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
]);

export function isChatAcceptedFile(file: File): boolean {
  if (file.type && ALLOWED_MIME.has(file.type)) return true;
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_EXT.has(name.slice(dot));
}

export function isChatImageContentType(contentType: string | undefined): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

export function isChatPdfContentType(contentType: string | undefined): boolean {
  return contentType === "application/pdf";
}

export function pickChatAcceptedFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(isChatAcceptedFile);
}
