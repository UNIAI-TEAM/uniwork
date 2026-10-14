export const workspaceKeys = {
  list: () => ["workspaces"] as const,
  bySlugs: (orgSlug: string, wsSlug: string) => ["workspace", orgSlug, wsSlug] as const,
  /** Prefix of every by-slug workspace query, old slugs included. */
  allBySlugs: () => ["workspace"] as const,
  members: (wsId: string) => ["members", wsId] as const,
  /** Prefix for every workspace's member list — use after profile avatar changes. */
  allMembers: () => ["members"] as const,
  me: (wsId: string) => ["workspace-me", wsId] as const,
  myInvitations: () => ["my-invitations"] as const,
  /** One invitation as its invitee sees it (spec 2026-10-13 §4.3). */
  invitationPreview: (token: string) => ["invitation-preview", token] as const,
};
