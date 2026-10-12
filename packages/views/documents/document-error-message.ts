import type { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";

type TFunction = ReturnType<typeof useTranslation>["t"];

// The refusals the server answers with a stable code (422): the tree rules,
// a folder too large to archive at once, a source file that may not be
// copied. Each has its own sentence in both languages; any other failure keeps the server's
// message, then the caller's fallback.
const CODED = new Set([
  "document_parent_kind",
  "document_cycle",
  "document_too_deep",
  "folder_not_supported",
  "folder_too_large",
  "source_not_saveable",
]);

/** A user-facing sentence for a failed documents write. */
export function documentErrorMessage(error: unknown, t: TFunction, fallbackKey: string): string {
  const code = errorCode(error);
  if (code && CODED.has(code)) return t(`documents.errors.${code}`);
  return apiErrorMessage(error) ?? t(fallbackKey);
}
