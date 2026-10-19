// The per-workspace unread counts behind the workspace switch and the pill's
// badge (MobileWorkspaces, MobileList boards), from GET /me/chat/unread-summary:
// `direct` is the DMs and groups of the organization, shown at every
// workspace, so only the `workspaces` rows tell one workspace from another.
import type { ChatUnreadSummary } from "@/data/chat-api";

export interface WorkspaceUnread {
  unread: number;
  mentions: number;
}

/** One workspace's own counts (its channels and workspace room), zero when the summary has no row for it. */
export function unreadOfWorkspace(summary: ChatUnreadSummary | undefined, wsId: string): WorkspaceUnread {
  const row = summary?.workspaces.find((entry) => entry.workspace_id === wsId);
  return { unread: row?.unread ?? 0, mentions: row?.mentions ?? 0 };
}

/** What the pill's red badge counts: unread in every workspace but the open one. */
export function unreadInOtherWorkspaces(summary: ChatUnreadSummary | undefined, currentWsId: string): number {
  return (summary?.workspaces ?? []).reduce((sum, entry) => (entry.workspace_id === currentWsId ? sum : sum + Math.max(0, entry.unread)), 0);
}

/** The tab bar's badge: the open workspace plus the organization-wide direct messages. */
export function unreadForTabBadge(summary: ChatUnreadSummary | undefined, currentWsId: string): number {
  return unreadOfWorkspace(summary, currentWsId).unread + Math.max(0, summary?.direct.unread ?? 0);
}

export type WorkspaceMetaKind = "open" | "open_unread" | "unread" | "unread_mentions" | "none";

/** Which line a workspace row says under its name. */
export function workspaceMetaKind(counts: WorkspaceUnread, current: boolean): WorkspaceMetaKind {
  if (current) return counts.unread > 0 ? "open_unread" : "open";
  if (counts.unread <= 0) return "none";
  return counts.mentions > 0 ? "unread_mentions" : "unread";
}

/** A count on a badge, capped the way the list caps it. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
