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

/**
 * `documentsToo` (UNI-1966): while the room allows document sends, the picker
 * also stages the document-only kinds (doc, pptx, md, …) that the plain file
 * route would refuse — they ride the document route instead.
 */
export function pickChatAcceptedFiles(files: Iterable<File>, documentsToo = false): File[] {
  return Array.from(files).filter(
    (file) => isChatAcceptedFile(file) || (documentsToo && isChatDocumentShareableFile(file)),
  );
}

/** Matches MaxChatFileMessageBytes (25 MiB) in the chat file service. */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const CHAT_FILE_MAX_LABEL = "25 MB";

export function isChatFileTooLarge(file: Blob): boolean {
  return file.size > CHAT_FILE_MAX_BYTES;
}

/**
 * UNI-1966: the composer's "send as document" allowlist mirrors
 * `documentMIMETypes` in server/internal/files/registry.go:236 — the MIME a
 * document upload verifies, with the file extensions that MIME carries.
 * `server/internal/service/chat_document_types_test.go` reads this table the
 * way TestChatFileAllowlistsAgree reads ALLOWED_MIME above: every row a
 * `{ mime: "…", exts: ["…", …] }` literal, MIMEs and extensions quoted.
 * Keep the row order of the Go slice.
 */
export const CHAT_DOCUMENT_SHAREABLE_TYPES: ReadonlyArray<{
  mime: string;
  exts: readonly string[];
}> = [
  { mime: "application/pdf", exts: [".pdf"] },
  { mime: "text/plain", exts: [".txt"] },
  { mime: "text/markdown", exts: [".md"] },
  { mime: "text/html", exts: [".html", ".htm"] },
  { mime: "application/msword", exts: [".doc"] },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", exts: [".docx"] },
  { mime: "application/vnd.ms-excel", exts: [".xls"] },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exts: [".xlsx"] },
  { mime: "application/vnd.ms-powerpoint", exts: [".ppt"] },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", exts: [".pptx"] },
  { mime: "application/vnd.oasis.opendocument.text", exts: [".odt"] },
  { mime: "image/jpeg", exts: [".jpg", ".jpeg"] },
  { mime: "image/png", exts: [".png"] },
  { mime: "image/gif", exts: [".gif"] },
  { mime: "image/webp", exts: [".webp"] },
  { mime: "image/svg+xml", exts: [".svg"] },
  { mime: "text/css", exts: [".css"] },
  { mime: "text/javascript", exts: [".js"] },
];

const DOCUMENT_MIME: Record<string, true> = {};
const DOCUMENT_EXT: Record<string, true> = {};
for (const row of CHAT_DOCUMENT_SHAREABLE_TYPES) {
  DOCUMENT_MIME[row.mime] = true;
  for (const ext of row.exts) DOCUMENT_EXT[ext] = true;
}

/** `accept` for the composer input while the room allows document sends. */
export const CHAT_DOCUMENT_ACCEPT = CHAT_DOCUMENT_SHAREABLE_TYPES.flatMap(
  (row) => [row.mime, ...row.exts],
).join(",");

/**
 * Whether the staged file may go through the document send: its MIME is on
 * the server allowlist, or — the same fallback isChatAcceptedFile uses — its
 * extension is, for a picker that reports no type.
 */
export function isChatDocumentShareableFile(file: File): boolean {
  if (file.type && DOCUMENT_MIME[file.type]) return true;
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return DOCUMENT_EXT[name.slice(dot)] === true;
}

/** Matches DefaultDocumentMaxBytes (200 MiB) in the document_file policy. */
export const CHAT_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;

export const CHAT_DOCUMENT_MAX_LABEL = "200 MB";

export function isChatDocumentTooLarge(file: Blob): boolean {
  return file.size > CHAT_DOCUMENT_MAX_BYTES;
}
