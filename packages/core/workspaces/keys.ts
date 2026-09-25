export const workspaceKeys = {
  list: () => ["workspaces"] as const,
  bySlugs: (orgSlug: string, wsSlug: string) => ["workspace", orgSlug, wsSlug] as const,
  members: (wsId: string) => ["members", wsId] as const,
  /** Prefix for every workspace's member list — use after profile avatar changes. */
  allMembers: () => ["members"] as const,
  me: (wsId: string) => ["workspace-me", wsId] as const,
  myInvitations: () => ["my-invitations"] as const,
};
