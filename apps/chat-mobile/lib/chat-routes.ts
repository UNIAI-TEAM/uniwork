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
};
