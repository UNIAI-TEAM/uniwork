import { apiErrorMessage, errorCode } from "@uniwork/core/api";

export function createProjectErrorMessage(
  err: unknown,
  copy: { duplicateTitle: string; fallback: string },
): string {
  if (errorCode(err) === "duplicate_project_title") return copy.duplicateTitle;
  return apiErrorMessage(err) ?? copy.fallback;
}
