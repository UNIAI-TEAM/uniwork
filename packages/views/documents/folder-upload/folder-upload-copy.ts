import type { useTranslation } from "react-i18next";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import {
  asFolderUploadRefusal,
  type FolderUploadPlan,
  type FolderUploadSkipReason,
} from "@uniwork/core/documents/folder-upload";

type TFunction = ReturnType<typeof useTranslation>["t"];

const GIB = 1024 ** 3;

function localeTag(locale: string): string {
  return locale.toLowerCase().startsWith("en") ? "en-US" : "vi-VN";
}

export function formatCount(count: number, locale: string): string {
  return new Intl.NumberFormat(localeTag(locale)).format(count);
}

/**
 * Sizes in a refusal: MB below 1 GB, GB with one decimal above. `up` rounds
 * the number up so an "actual" that is over its limit never reads as equal to
 * it ("2 GB — tối đa 2 GB").
 */
export function formatUploadBytes(bytes: number, locale: string, rounding: "up" | "nearest" = "nearest"): string {
  if (bytes < GIB) return formatDocumentSizeMB(bytes, locale);
  const tenths = rounding === "up" ? Math.ceil((bytes / GIB) * 10 - 1e-9) : Math.round((bytes / GIB) * 10);
  const value = tenths / 10;
  const whole = tenths % 10 === 0;
  const formatted = new Intl.NumberFormat(localeTag(locale), {
    minimumFractionDigits: whole ? 0 : 1,
    maximumFractionDigits: whole ? 0 : 1,
  }).format(value);
  return `${formatted} GB`;
}

/**
 * The numbers-bearing sentence of a whole-run refusal, e.g. "612 tệp — tối đa 500".
 * `lowerBound` marks an `actual` the read stopped at (a dropped folder cut at
 * the read bound): the file count then reads "Hơn 2.000 tệp — tối đa 500".
 */
export function refusalMessage(
  t: TFunction,
  refusal: NonNullable<FolderUploadPlan["refusal"]>,
  locale: string,
  opts: { lowerBound?: boolean } = {},
): string {
  const { limit, actual } = refusal;
  // The planner's code union gains too_many_folders with the v0.2 config; read it as a string so either side may land first.
  const code: string = refusal.code;
  switch (code) {
    case "too_many_files":
    case "too_many_folders":
    case "too_deep":
      return t(`documents.folder_upload.refusal.${code === "too_many_files" && opts.lowerBound ? "too_many_files_over" : code}`, {
        actual: formatCount(actual ?? 0, locale),
        limit: formatCount(limit ?? 0, locale),
        count: actual ?? 0,
      });
    case "too_large_total":
      return t("documents.folder_upload.refusal.too_large_total", {
        actual: formatUploadBytes(actual ?? 0, locale, "up"),
        limit: formatUploadBytes(limit ?? 0, locale),
      });
    case "nothing_to_upload":
    case "segment_too_long":
    case "multiple_roots":
      return t(`documents.folder_upload.refusal.${code}`);
    default:
      return t("documents.folder_upload.refusal.unknown");
  }
}

const SKIP_REASONS: readonly FolderUploadSkipReason[] = [
  "hidden",
  "unsupported_format",
  "too_large",
  "name_too_long",
  "invalid_path",
];

export function skipReasonLabel(t: TFunction, reason: string): string {
  return SKIP_REASONS.includes(reason as FolderUploadSkipReason)
    ? t(`documents.folder_upload.skip_reason.${reason}`)
    : t("documents.folder_upload.skip_reason.invalid_path");
}

// Per-file codes: the server's complete step (contract v0.2 §3) plus the
// client's own PUT failures (`FolderUploadFailedFile.code`).
const FAILURE_CODES = [
  "upload_missing",
  "size_mismatch",
  "unsupported_media",
  "storage_quota_exceeded",
  "not_found",
  "parts_invalid",
  "network",
  "target_expired",
  "http_5xx",
  "missing_etag",
  "missing_part_url",
  "untrusted_target",
  "aborted",
  "folder_upload_file_settled",
  "folder_upload_target_signed",
] as const;

// Reasons the server gives beside `unsupported_media`; one it has not told us about reads as the plain sentence.
const UNSUPPORTED_MEDIA_REASONS = ["zip_unreadable"] as const;

// Sentences that already tell the person what to do once retrying cannot help
// (fix the file, free space, upload again): the report adds no hint under them.
const SELF_HINTED_FINAL = new Set([
  "unsupported_media",
  "unsupported_media_zip_unreadable",
  "storage_quota_exceeded",
  "not_found",
  "untrusted_target",
  "folder_upload_target_signed",
]);

/** The `report.reason.*` key of a failure; a code the client does not know is `unknown`, any `http_5nn` is `http_5xx`. */
function failureSentenceKey(code: string | undefined, reason?: string): string {
  const known = /^http_5\d\d$/.test(code ?? "") ? "http_5xx" : code ?? "";
  if (known === "unsupported_media" && (UNSUPPORTED_MEDIA_REASONS as readonly string[]).includes(reason ?? "")) {
    return `unsupported_media_${reason}`;
  }
  return (FAILURE_CODES as readonly string[]).includes(known) ? known : "unknown";
}

/** One sentence per failure code (and `unsupported_media` reason); a code the client does not know reads as the generic one. */
export function failureReasonMessage(t: TFunction, code: string | undefined, reason?: string): string {
  return t(`documents.folder_upload.report.reason.${failureSentenceKey(code, reason)}`);
}

/** True when the failure's own sentence already says what to do after a final failure. */
export function failureSentenceHasHint(code: string | undefined, reason?: string): boolean {
  return SELF_HINTED_FINAL.has(failureSentenceKey(code, reason));
}

// Whole-run answers with a fixed sentence (the ones with numbers or a file name are cased in runErrorMessage).
const RUN_ERROR_CODES = [
  "document_parent_kind",
  "folder_upload_file_settled",
  "folder_upload_target_signed",
  "folder_uploads_busy",
  "idempotency_payload_mismatch",
  "http_403",
  "http_404",
] as const;

/** The file a refusal names: its path when the server sent one, else its file name. */
function fileOf(fields: Record<string, unknown>): string | null {
  for (const key of ["path", "filename"]) {
    const value = fields[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/**
 * The sentence for a run that failed as a whole: a refused plan (with its
 * numbers from `fields`) or 429 busy. A 410 expired or 409 canceled batch never
 * gets here: the runner turns it into an `expired` / `canceled` report.
 * Anything the client has no sentence for reads as the generic one.
 */
export function runErrorMessage(t: TFunction, error: unknown, locale: string): string {
  const refusal = asFolderUploadRefusal(error);
  if (!refusal) return t("documents.folder_upload.error.unknown");
  const { code, fields } = refusal;
  const num = (key: string): number => (typeof fields[key] === "number" ? (fields[key] as number) : 0);
  switch (code) {
    case "folder_upload_too_many_files":
    case "folder_upload_too_many_folders":
      return t(`documents.folder_upload.error.${code}`, {
        max: formatCount(num("max"), locale),
        actual: formatCount(num("count"), locale),
      });
    case "folder_upload_too_large":
      return t("documents.folder_upload.error.folder_upload_too_large", {
        max: formatUploadBytes(num("max_bytes"), locale),
        total: formatUploadBytes(num("total_bytes"), locale, "up"),
      });
    case "document_too_deep":
      return t("documents.folder_upload.error.document_too_deep", { max: formatCount(num("max_depth"), locale) });
    case "invalid_request":
    case "folder_upload_unsupported_type": {
      const file = fileOf(fields);
      return file ? t(`documents.folder_upload.error.${code}_named`, { file }) : t(`documents.folder_upload.error.${code}`);
    }
    case "folder_upload_file_too_large": {
      const file = fileOf(fields);
      return file
        ? t("documents.folder_upload.error.folder_upload_file_too_large_named", {
            file,
            max: formatUploadBytes(num("max_bytes"), locale),
          })
        : t("documents.folder_upload.error.folder_upload_file_too_large");
    }
    default:
      return (RUN_ERROR_CODES as readonly string[]).includes(code)
        ? t(`documents.folder_upload.error.${code}`)
        : t("documents.folder_upload.error.unknown");
  }
}

/** Skipped files grouped by reason, in the planner's reason order. */
export function groupSkipped(
  skipped: FolderUploadPlan["skipped"],
): { reason: FolderUploadSkipReason; paths: string[] }[] {
  const groups: { reason: FolderUploadSkipReason; paths: string[] }[] = [];
  for (const reason of SKIP_REASONS) {
    const paths = skipped.filter((s) => s.reason === reason).map((s) => s.path);
    if (paths.length > 0) groups.push({ reason, paths });
  }
  return groups;
}
