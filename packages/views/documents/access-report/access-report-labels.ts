import type { useTranslation } from "react-i18next";
import type { ReportFacts } from "@uniwork/core/documents/access-report-facts";
import type { AccessReportFlag } from "@uniwork/core/types/document-access-report";

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

/** A grant's source as the report names it: a share by its origin, and a share without one as shared directly. */
export function accessSourceLabel(t: TFunction, row: { source: string; origin?: string | null }): string {
  switch (row.source) {
    case "acl_owner":
    case "break_glass":
    case "link":
      return t(`documents.accessReport.source_${row.source}`);
    case "workspace":
      return t("documents.accessReport.source_workspace_default");
    case "share":
      if (!row.origin || row.origin === "direct") return t("documents.accessReport.source_direct");
      if (row.origin === "chat") return t("documents.accessReport.source_chat");
      return t("documents.accessReport.source_other");
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

/** The general access pill: private, the workspace at a level, or the whole organization at a level. */
export function generalScopeLabel(t: TFunction, scope: { kind: string; level: string | null }): string {
  const level = accessLevelLabel(t, scope.level ?? "");
  switch (scope.kind) {
    case "restricted":
      return t("documents.accessReport.scope_private");
    case "workspace":
      return t("documents.accessReport.scope_workspace_level", { level });
    case "organization":
      return t("documents.accessReport.scope_organization_level", { level });
    default:
      return t("documents.accessReport.visibility_other");
  }
}

/** A warning badge; the flags are a closed set once parsed, so there is no Other. */
export function flagLabel(t: TFunction, flag: AccessReportFlag): string {
  return t(`documents.accessReport.flag_${flag}`);
}

interface WhoRow {
  principal_type: string;
  principal_id: string;
}

/**
 * The short "who has access" line beside the avatars — "3 people · 1 link",
 * "The whole workspace · 1 person": groups first, then people, then links.
 * The counts come from `deriveReportFacts`, the one place they are made.
 */
export function whoSummary(
  t: TFunction,
  facts: Pick<ReportFacts, "people" | "links" | "otherWorkspaces" | "workspaceWide" | "organizationWide">,
): string {
  const parts: string[] = [];
  if (facts.organizationWide) parts.push(t("documents.accessReport.who_organization"));
  if (facts.workspaceWide) parts.push(t("documents.accessReport.who_workspace"));
  if (facts.otherWorkspaces > 0) parts.push(t("documents.accessReport.who_other_workspaces", { count: facts.otherWorkspaces }));
  if (facts.people > 0) parts.push(t("documents.accessReport.who_people", { count: facts.people }));
  if (facts.links > 0) parts.push(t("documents.accessReport.who_links", { count: facts.links }));
  return parts.join(" · ");
}

/** The small note beside a grantee's name: "You", the kind of group, or nothing for another person. */
export function grantKindNote(t: TFunction, row: WhoRow, wsId: string, viewerId: string | null): string {
  switch (row.principal_type) {
    case "user":
      return viewerId && row.principal_id === viewerId ? t("documents.accessReport.you") : "";
    case "workspace":
      return row.principal_id === wsId
        ? t("documents.share.principal_workspace")
        : t("documents.accessReport.kind_other_workspace");
    case "organization":
      return t("documents.accessReport.kind_organization");
    case "link":
      return t("documents.accessReport.kind_link");
    default:
      return t("documents.accessReport.principal_other");
  }
}
