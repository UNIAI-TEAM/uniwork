import type { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode, errorFields } from "@uniwork/core/api";
import { classifyDocumentError, isDocumentNotInTrashError, isFolderTooLargeError } from "@uniwork/core/documents/errors";
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
  fallbackOpts?: Record<string, unknown>;
}

// The refusals the server answers with a stable code (422): the tree rules,
// a folder too large to archive at once, a source file that may not be
// copied, a folder name already taken (409). Each has its own sentence in both
// languages; any other failure keeps the server's message, then the caller's
// fallback. The depth sentence names the shared limit through {{max}}.
const CODED = new Set([
  "document_parent_kind",
  "document_cycle",
  "document_too_deep",
  "folder_not_supported",
  "folder_too_large",
  "folder_name_taken",
  "source_not_saveable",
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
  const code = errorCode(error);
  if (code === "file_too_large") {
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
  if (code && CODED.has(code)) return t(`documents.errors.${code}`, { max: TREE_MAX_LEVEL });
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

