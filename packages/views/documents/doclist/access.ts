import type { DocumentShareScope } from "@uniwork/core/types/document";

// What the Truy cập column says about a document, as pure functions of the
// summary fields every list row carries (visibility, share_scope, my_level).

export type DocAccessKind = "restricted" | "workspace" | "shared";

/**
 * The pill: Workspace when the document is visible to its workspace; else
 * Được chia sẻ when anyone beyond the owner can reach it (people, other
 * workspaces, the organization, a live link); else Riêng tư. A missing
 * `share_scope` is never guessed: a restricted row without one reads Riêng tư.
 */
export function docAccessKind(visibility: string | null | undefined, shareScope: DocumentShareScope | null | undefined): DocAccessKind {
  if (visibility === "workspace") return "workspace";
  const reachable = Boolean(shareScope && (shareScope.users > 0 || shareScope.workspaces > 0 || shareScope.organization || shareScope.public_link));
  return reachable ? "shared" : "restricted";
}

export type DocAccessLevel = "view" | "comment" | "edit" | "manage";

/**
 * The viewer's level for the "Bạn: …" line. A server level this client does
 * not list reads as no line; a workspace administrator arrives with no level
 * and `admin_scope`, and administers the row, so that reads as manage.
 */
export function docAccessLevel(myLevel: string | null | undefined, adminScope?: boolean | null): DocAccessLevel | null {
  switch (myLevel) {
    case "view":
    case "comment":
    case "edit":
    case "manage":
      return myLevel;
    default:
      return !myLevel && adminScope === true ? "manage" : null;
  }
}
