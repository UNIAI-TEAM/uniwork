import {
  DEFAULT_DOCUMENT_LIMITS,
  DEFAULT_DOCUMENT_MAX_BYTES,
  DEFAULT_DOCUMENT_SAVE_WARN_RATIO,
  DEFAULT_DOCUMENT_WEB_OPEN_LIMITS,
  type DocumentLimits,
  type DocumentWebOpenLimit,
  type DocumentWebOpenLimits,
} from "../api/endpoints/config";
import { usePublicConfig } from "../feature-flags/use-public-config";

export {
  DEFAULT_DOCUMENT_LIMITS,
  DEFAULT_DOCUMENT_MAX_BYTES,
  DEFAULT_DOCUMENT_SAVE_WARN_RATIO,
  DEFAULT_DOCUMENT_WEB_OPEN_LIMITS,
  type DocumentLimits,
  type DocumentWebOpenLimit,
  type DocumentWebOpenLimits,
};

const MIB = 1024 * 1024;

/**
 * Extensions the server accepts for a file document (`server/internal/document/mime.go`).
 * Checked before uploading so an unsupported extension fails before any bytes leave the browser.
 */
export const ALLOWED_DOCUMENT_FILE_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "txt",
  "md",
  "markdown",
  "csv",
  "html",
  "htm",
  "zip",
]);

export const DOCUMENT_UPLOAD_ACCEPT = Array.from(ALLOWED_DOCUMENT_FILE_EXTENSIONS, (ext) => `.${ext}`).join(",");

/**
 * Document size limits from `GET /api/v1/config` (`documents.limits`), falling
 * back to the contract §3.1 defaults while loading or when config is absent.
 */
export function useDocumentLimits(options?: { enabled?: boolean }): DocumentLimits {
  const { data } = usePublicConfig(options);
  return data?.documents?.limits ?? DEFAULT_DOCUMENT_LIMITS;
}

/**
 * Deterministic binary-MiB formatter displaying "MB" (`contract-size-frame-v0.1` §6.1):
 * - Whole numbers render with 0 decimal places ("200 MB", "180 MB").
 * - Non-whole numbers render with at most 1 decimal place ("185,4 MB" in vi, "185.4 MB" in en).
 * - When `maxBytes` is given and `bytes > maxBytes`, rounds UP to 0.1 MB (at least 0.1 MB above
 *   `maxBytes`) so a file 1 byte over 200 MiB displays "200,1 MB" / "200.1 MB", never "200 MB".
 */
export function formatDocumentSizeMB(bytes: number, locale?: string, maxBytes?: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let tenths: number;
  if (maxBytes !== undefined && safeBytes > maxBytes) {
    const maxTenths = Math.round((maxBytes / MIB) * 10);
    tenths = Math.max(Math.ceil((safeBytes / MIB) * 10), maxTenths + 1);
  } else {
    tenths = Math.round((safeBytes / MIB) * 10);
  }
  const value = tenths / 10;
  const isWhole = tenths % 10 === 0;
  const localeTag = locale?.toLowerCase().startsWith("en") ? "en-US" : "vi-VN";
  const formatted = new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: isWhole ? 0 : 1,
  }).format(value);
  return `${formatted} MB`;
}

export type DocumentUploadValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_large"; maxBytes: number }
  | { ok: false; reason: "unsupported_format" };

function fileExtensionOf(filename: string): string | null {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return trimmed.slice(dot + 1).toLowerCase();
}

export function isAllowedDocumentFileName(filename: string): boolean {
  const ext = fileExtensionOf(filename);
  if (!ext) return false;
  return ALLOWED_DOCUMENT_FILE_EXTENSIONS.has(ext);
}

/**
 * Pre-upload check run before any HTTP request is made (contract §4 item 1):
 * verifies the file extension against the supported document format list and
 * compares `file.size` against `upload_max_bytes`.
 */
export function validateDocumentUploadFile(
  file: { name: string; size: number },
  maxBytes: number = DEFAULT_DOCUMENT_MAX_BYTES,
): DocumentUploadValidationResult {
  if (!isAllowedDocumentFileName(file.name)) {
    return { ok: false, reason: "unsupported_format" };
  }
  if (file.size > maxBytes) {
    return { ok: false, reason: "too_large", maxBytes };
  }
  return { ok: true };
}
