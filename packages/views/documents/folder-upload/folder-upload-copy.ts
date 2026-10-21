import type { useTranslation } from "react-i18next";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import type { FolderUploadPlan, FolderUploadSkipReason } from "@uniwork/core/documents/folder-upload/types";

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

/** The numbers-bearing sentence of a whole-run refusal, e.g. "612 tệp — tối đa 500". */
export function refusalMessage(
  t: TFunction,
  refusal: NonNullable<FolderUploadPlan["refusal"]>,
  locale: string,
): string {
  const { code, limit, actual } = refusal;
  switch (code) {
    case "too_many_files":
    case "too_deep":
      return t(`documents.folder_upload.refusal.${code}`, {
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

const FAILURE_CODES = [
  "folder_upload_too_many_files",
  "folder_upload_too_large",
  "folder_upload_too_deep",
  "parent_forbidden",
  "unsupported_format",
  "quota_exceeded",
  "missing_etag",
] as const;

/** One sentence per failure code; a code the client does not know reads as the generic one. */
export function failureReasonMessage(t: TFunction, code: string | undefined): string {
  return (FAILURE_CODES as readonly string[]).includes(code ?? "")
    ? t(`documents.folder_upload.report.reason.${code}`)
    : t("documents.folder_upload.report.reason.unknown");
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
