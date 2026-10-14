import type { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";

type TFunction = ReturnType<typeof useTranslation>["t"];

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

/** A user-facing sentence for a failed documents write. */
export function documentErrorMessage(error: unknown, t: TFunction, fallbackKey: string): string {
  const code = errorCode(error);
  if (code && CODED.has(code)) return t(`documents.errors.${code}`, { max: TREE_MAX_LEVEL });
  return apiErrorMessage(error) ?? t(fallbackKey);
}
