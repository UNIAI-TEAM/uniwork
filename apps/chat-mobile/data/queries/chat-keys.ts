// The mobile chat tab's query keys. Its own factory (ADR 0011 §3: the web's
// chatKeys sits behind web-only modules); every key carries the workspace id
// right after "chat", so one workspace's chat drops with a single prefix.
export const chatKeys = {
  rooms: (wsId: string) => ["chat", wsId, "rooms"] as const,
  /** One room's main timeline (`RoomTimeline`, patched in place by realtime and sends). */
  roomMessages: (wsId: string, roomId: string) => ["chat", wsId, "room-messages", roomId] as const,
  /** Prefix: every loaded room timeline of the workspace (reconnect). */
  roomMessagesRoot: (wsId: string) => ["chat", wsId, "room-messages"] as const,
  /** The page around one message, while a deep link or a reply quote jumps to it. */
  roomMessagesAround: (wsId: string, roomId: string, messageId: string) =>
    ["chat", wsId, "room-around", roomId, messageId] as const,
  /** Prefix: every around-page of one room; it is never patched, only refetched. */
  roomAroundRoot: (wsId: string, roomId: string) => ["chat", wsId, "room-around", roomId] as const,
  threadMessages: (wsId: string, roomId: string, rootId: string) =>
    ["chat", wsId, "thread-messages", roomId, rootId] as const,
  /** Prefix: every loaded thread of one room. */
  roomThreads: (wsId: string, roomId: string) => ["chat", wsId, "thread-messages", roomId] as const,
  roomMembers: (wsId: string, roomId: string) => ["chat", wsId, "room-members", roomId] as const,
  roomSearch: (wsId: string, roomId: string, q: string) => ["chat", wsId, "room-search", roomId, q] as const,
  discoverableChannels: (wsId: string) => ["chat", wsId, "channels", "discoverable"] as const,
  nicknames: (wsId: string) => ["chat", wsId, "nicknames"] as const,
  members: (wsId: string) => ["chat", wsId, "members"] as const,
  // M3 rich kinds.
  /** This person's follow-ups in the workspace, done ones included. */
  followUps: (wsId: string) => ["chat", wsId, "follow-ups"] as const,
  /** The task links of the messages one room shows. */
  roomLinks: (wsId: string, roomId: string, messageIds: readonly string[]) => ["chat", wsId, "message-links", roomId, messageIds.join(",")] as const,
  /** Prefix: every link list of one room. */
  roomLinksRoot: (wsId: string, roomId: string) => ["chat", wsId, "message-links", roomId] as const,
  task: (wsId: string, taskId: string) => ["chat", wsId, "task", taskId] as const,
  expressions: (wsId: string, kind: "stickers" | "gifs", q: string) => ["chat", wsId, "expressions", kind, q] as const,
};
