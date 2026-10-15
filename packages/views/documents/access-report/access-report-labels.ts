import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** The levels a grant can carry, weakest first; the level filter offers these. */
export const REPORT_LEVELS = ["view", "comment", "edit", "manage"] as const;

/** Server enums are open strings: a value this build does not know reads "Other". */
export function accessLevelLabel(t: TFunction, level: string): string {
  switch (level) {
    case "view":
    case "comment":
    case "edit":
    case "manage":
    case "none":
      return t(`documents.accessReport.level_${level}`);
    default:
      return t("documents.accessReport.level_other");
  }
}

export function accessSourceLabel(t: TFunction, source: string): string {
  switch (source) {
    case "acl_owner":
    case "share":
    case "workspace":
    case "break_glass":
      return t(`documents.accessReport.source_${source}`);
    default:
      return t("documents.accessReport.source_other");
  }
}

export function accessVisibilityLabel(t: TFunction, visibility: string): string {
  switch (visibility) {
    case "workspace":
      return t("documents.share.visibility_workspace");
    case "restricted":
      return t("documents.share.visibility_restricted");
    default:
      return t("documents.accessReport.visibility_other");
  }
}

/**
 * The visibility filter's options. They name who can see the document, not the
 * report's scope, so the "workspace" option is not the "Whole workspace" line.
 */
export function filterVisibilityLabel(t: TFunction, visibility: string): string {
  return visibility === "workspace"
    ? t("documents.accessReport.visibility_workspace")
    : accessVisibilityLabel(t, visibility);
}

/** What a principal is when the report has no name for it (an account that is gone). */
export function principalTypeLabel(t: TFunction, principalType: string): string {
  switch (principalType) {
    case "user":
    case "workspace":
    case "organization":
      return t(`documents.share.principal_${principalType}`);
    default:
      return t("documents.accessReport.principal_other");
  }
}
