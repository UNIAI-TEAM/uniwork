import type { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";

type TFunction = ReturnType<typeof useTranslation>["t"];

// The tree refusals the server answers with a stable code (422). Each has its
// own sentence in both languages; any other failure keeps the server's
// message, then the caller's fallback.
const TREE_CODES = new Set(["document_parent_kind", "document_cycle", "document_too_deep", "folder_not_supported"]);

/** A user-facing sentence for a failed documents write. */
export function documentErrorMessage(error: unknown, t: TFunction, fallbackKey: string): string {
  const code = errorCode(error);
  if (code && TREE_CODES.has(code)) return t(`documents.errors.${code}`);
  return apiErrorMessage(error) ?? t(fallbackKey);
}
