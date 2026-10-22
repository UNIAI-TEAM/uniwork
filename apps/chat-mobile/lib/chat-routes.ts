// The chat tab's routes under app/(app)/[org]/[ws]/. The tab itself is
// lib/deep-link.ts › deepLinkHref (the contract with push taps and the other
// tabs); these are the screens it pushes.
export interface WorkspaceSlugs {
  orgSlug: string;
  wsSlug: string;
}

const base = (ws: WorkspaceSlugs) => `/${encodeURIComponent(ws.orgSlug)}/${encodeURIComponent(ws.wsSlug)}`;

export const chatRoutes = {
  room: (ws: WorkspaceSlugs, roomId: string, messageId?: string) =>
    `${base(ws)}/room/${encodeURIComponent(roomId)}${messageId ? `?message=${encodeURIComponent(messageId)}` : ""}`,
  thread: (ws: WorkspaceSlugs, roomId: string, rootId: string) =>
    `${base(ws)}/room/${encodeURIComponent(roomId)}/thread/${encodeURIComponent(rootId)}`,
  info: (ws: WorkspaceSlugs, roomId: string) => `${base(ws)}/room/${encodeURIComponent(roomId)}/info`,
  newChat: (ws: WorkspaceSlugs) => `${base(ws)}/new-chat`,
  channels: (ws: WorkspaceSlugs) => `${base(ws)}/channels`,
  /** A new group, or (with a room) more members for that group. */
  newGroup: (ws: WorkspaceSlugs, roomId?: string) => `${base(ws)}/new-group${roomId ? `?room=${encodeURIComponent(roomId)}` : ""}`,
};

/**
 * The account's own screens, under app/(app)/ and outside every workspace: a person with no
 * workspace (removed from all of them, or signed up and not onboarded) still reaches Settings,
 * the legal pages and account deletion from select-workspace (Apple 5.1.1(v), Play's account
 * deletion policy: deletion is reachable from every signed-in state).
 */
export const accountRoutes = {
  settings: "/account",
  /** Settings › Privacy & legal › Open-source licenses. */
  licenses: "/licenses",
} as const;
