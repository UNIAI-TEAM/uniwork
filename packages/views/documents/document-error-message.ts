import type { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage, errorCode, errorFields } from "@uniwork/core/api";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import {
  classifyDocumentError,
  isDocumentNotInTrashError,
  isDocumentShelvedError,
  isFolderTooLargeError,
} from "@uniwork/core/documents/errors";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import {
  DEFAULT_DOCUMENT_MAX_BYTES,
  formatDocumentSizeMB,
  validateDocumentUploadFile,
} from "@uniwork/core/documents/limits";

type TFunction = ReturnType<typeof useTranslation>["t"];

interface DocumentErrorMessageOptions {
  locale?: string;
  file?: { name: string; size: number };
  maxBytes?: number;
  resumable?: boolean;
  fallbackOpts?: Record<string, unknown>;
}

// The refusals the server answers with a stable code (422/409/415): the tree
// rules, a folder too large to archive at once, a source file that may not be
// copied, a folder name already taken, or an upload-session / quota refusal.
// Each has its own sentence in both languages; any other failure keeps the
// server's message, then the caller's fallback. The depth sentence names the
// shared limit through {{max}}.
const CODED = new Set([
  "document_parent_kind",
  "document_cycle",
  "document_too_deep",
  "folder_not_supported",
  "folder_not_shareable",
  "folder_too_large",
  "folder_name_taken",
  "source_not_saveable",
  "my_folder_locked",
  "upload_sessions_exhausted",
  "upload_session_expired",
  "upload_parts_invalid",
  "upload_size_mismatch",
  "upload_probe_mismatch",
  "quota_exceeded",
]);

/**
 * Validates a picked or dropped file before sending any bytes to the server.
 * Returns the user-facing error message when rejected, or null when valid.
 */
export function documentUploadValidationMessage(
  file: { name: string; size: number },
  maxBytes: number,
  t: TFunction,
  locale?: string,
): string | null {
  const check = validateDocumentUploadFile(file, maxBytes);
  if (check.ok) return null;
  if (check.reason === "unsupported_format") {
    return t("documents.upload.unsupported_format", { name: file.name });
  }
  return t("documents.upload.too_large_named", {
    name: file.name,
    size: formatDocumentSizeMB(file.size, locale, check.maxBytes),
    max: formatDocumentSizeMB(check.maxBytes, locale),
  });
}

/** A user-facing sentence for a failed documents write. */
export function documentErrorMessage(
  error: unknown,
  t: TFunction,
  fallbackKey: string,
  opts?: DocumentErrorMessageOptions,
): string {
  if (error instanceof ChunkedUploadError) {
    if (error.code === "central_directory_too_large") {
      if (opts?.file) {
        return t("documents.upload.unsupported_format", { name: opts.file.name });
      }
      return t("documents.errors.unsupported_media_type");
    }
    if (opts?.resumable) return t("documents.upload.failed_resumable");
    return t(fallbackKey, opts?.fallbackOpts);
  }
  const code = errorCode(error);
  if (code === "file_too_large" || (error instanceof ApiError && error.status === 413)) {
    const rawMax = errorFields(error)?.max_bytes;
    const maxBytes =
      typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0
        ? rawMax
        : (opts?.maxBytes ?? DEFAULT_DOCUMENT_MAX_BYTES);
    const max = formatDocumentSizeMB(maxBytes, opts?.locale);
    if (opts?.file) {
      return t("documents.upload.too_large_named", {
        name: opts.file.name,
        size: formatDocumentSizeMB(opts.file.size, opts.locale, maxBytes),
        max,
      });
    }
    return t("documents.errors.file_too_large", { max });
  }
  if (code === "unsupported_media_type" || (error instanceof ApiError && error.status === 415)) {
    if (opts?.file) {
      if (errorFields(error)?.reason === "zip_unreadable") {
        return t("documents.upload.unreadable_file", { name: opts.file.name });
      }
      return t("documents.upload.unsupported_format", { name: opts.file.name });
    }
    return t("documents.errors.unsupported_media_type");
  }
  if (code === "document_locked" || (error instanceof ApiError && error.status === 423)) {
    // The same person's hold in another window (pre-check or 423 body) gets
    // its own sentence; any other holder keeps the shared one (L-1).
    if (errorFields(error)?.held_by_me === true) {
      return t("documents.upload.document_locked_by_me");
    }
    return t("documents.upload.document_locked");
  }
  if (code && CODED.has(code)) return t(`documents.errors.${code}`, { max: TREE_MAX_LEVEL });
  // ARCHIVE-01 U-10: every web write onto an archived document says the same sentence.
  if (isDocumentShelvedError(error)) return t("documents.shelved_doc.write_blocked");
  if (opts?.resumable) return t("documents.upload.failed_resumable");
  return apiErrorMessage(error) ?? t(fallbackKey, opts?.fallbackOpts);
}

/**
 * A user-facing sentence for a failed trash command (RESTORE-01): restore and
 * purge share the three named refusals — the item is no longer in the trash,
 * the folder's subtree is too large to purge in one call, and the caller does
 * not manage it (403). Anything else keeps the server's message, then the
 * caller's fallback, exactly like documentErrorMessage.
 */
export function trashErrorMessage(error: unknown, t: TFunction, fallbackKey: string): string {
  if (isDocumentNotInTrashError(error)) return t("documents.trash.not_in_trash");
  if (isFolderTooLargeError(error)) return t("documents.trash.too_large");
  if (classifyDocumentError(error).cls === "permission") return t("documents.trash.no_permission");
  return apiErrorMessage(error) ?? t(fallbackKey);
}
