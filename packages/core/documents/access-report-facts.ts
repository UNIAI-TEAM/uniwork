import type {
  AccessReportDocument,
  AccessReportFlag,
  AccessReportGeneralScope,
  AccessReportRow,
} from "../types/document-access-report";

// The one place the access report reads a document's general access, warning
// flags, people/link counts and last access change (UNI-2039). The server
// sends `general_scope` and `flags` (S1) so the tiles, the filters and the
// badges share one definition; until it does, or when a field is unreadable,
// this derives the same answer from the rows. Tile definitions:
//   public_link      a live link exists
//   other_workspace  a live share to a workspace other than the report's own
//   organization     a live share to the organization
//   direct_manage    a live share at `manage` to anyone but the ACL owner
// Owner, workspace-default and break-glass rows never raise a flag.

export interface ReportFacts {
  generalScope: AccessReportGeneralScope;
  flags: AccessReportFlag[];
  /** Latest access change: the server's mark, else the content's `updated_at`. */
  changedAt: string;
  /** Distinct people with a live row of their own (owner, shares, break-glass). */
  people: number;
  /** Live public links. */
  links: number;
  /** Distinct other workspaces holding a live share. */
  otherWorkspaces: number;
  /** The whole home workspace has access through a default or a share. */
  workspaceWide: boolean;
  /** The whole organization has access through a share. */
  organizationWide: boolean;
}

const FLAG_ORDER: readonly AccessReportFlag[] = ["public_link", "other_workspace", "organization", "direct_manage"];

function live(rows: readonly AccessReportRow[]): AccessReportRow[] {
  return rows.filter((r) => r.active);
}

function derivedGeneralScope(
  visibility: string,
  rows: readonly AccessReportRow[],
): AccessReportGeneralScope {
  const org = rows.find((r) => r.principal_type === "organization");
  if (org) return { kind: "organization", level: org.level };
  if (visibility === "restricted") return { kind: "restricted", level: null };
  const home = rows.find((r) => r.source === "workspace");
  return { kind: "workspace", level: home?.level ?? null };
}

export function deriveReportFacts(
  document: AccessReportDocument["document"],
  rows: readonly AccessReportRow[],
  wsId: string,
): ReportFacts {
  const liveRows = live(rows);
  const linkRows = liveRows.filter((r) => r.source === "link" || r.principal_type === "link");
  // Before the server sends link rows (S2) only the count is known.
  const links = linkRows.length > 0 ? linkRows.length : document.live_link_count;
  const shares = liveRows.filter((r) => r.source === "share");
  const otherWorkspaceIds = new Set(
    shares.filter((r) => r.principal_type === "workspace" && r.principal_id !== wsId).map((r) => r.principal_id),
  );
  const organizationWide = shares.some((r) => r.principal_type === "organization");
  const ownerId = document.acl_owner?.id ?? null;

  const derived = new Set<AccessReportFlag>();
  if (links > 0) derived.add("public_link");
  if (otherWorkspaceIds.size > 0) derived.add("other_workspace");
  if (organizationWide) derived.add("organization");
  if (shares.some((r) => r.level === "manage" && r.principal_id !== ownerId)) derived.add("direct_manage");

  // Present (even empty) = the server's answer; absent = the derived one.
  const flags = document.flags ?? FLAG_ORDER.filter((f) => derived.has(f));

  const people = new Set(
    liveRows.filter((r) => r.principal_type === "user").map((r) => r.principal_id),
  ).size;
  const homeWide = liveRows.some(
    (r) => r.source === "workspace" || (r.source === "share" && r.principal_type === "workspace" && r.principal_id === wsId),
  );

  return {
    generalScope: document.general_scope ?? derivedGeneralScope(document.visibility, liveRows),
    flags,
    changedAt: document.access_changed_at || document.updated_at,
    people,
    links,
    otherWorkspaces: otherWorkspaceIds.size,
    workspaceWide: homeWide,
    organizationWide,
  };
}
