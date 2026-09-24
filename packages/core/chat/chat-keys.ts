export const chatKeys = {
  room: (wsId: string) => ["chat", "room", wsId] as const,
  rooms: (wsId: string) => ["chat", "rooms", wsId] as const,
  channels: (wsId: string, scope: string, projectId = "", q = "") =>
    ["chat", "channels", wsId, scope, projectId, q] as const,
  projectChannels: (wsId: string, projectId: string) =>
    ["chat", "project-channels", wsId, projectId] as const,
  messages: (wsId: string) => ["chat", "messages", wsId] as const,
  roomMessages: (wsId: string, roomId: string) => ["chat", "room-messages", wsId, roomId] as const,
  /** Prefix — invalidate all open room timelines for a workspace (reconnect). */
  roomMessagesRoot: (wsId: string) => ["chat", "room-messages", wsId] as const,
  /**
   * Older history the room bulletin pages in on request, from a frozen cursor.
   * Deliberately outside the "room-messages" prefix: those entries are flat
   * arrays that writers patch in place; these are infinite-query pages.
   */
  roomBulletinOlder: (wsId: string, roomId: string, from: string) =>
    ["chat", "room-bulletin-older", wsId, roomId, from] as const,
  threadMessages: (wsId: string, roomId: string, threadRootId: string) =>
    ["chat", "thread-messages", wsId, roomId, threadRootId] as const,
  /** Prefix — invalidate all cached thread timelines for a workspace. */
  threadMessagesRoot: (wsId: string) => ["chat", "thread-messages", wsId] as const,
  followedThreads: (wsId: string, unread = false) =>
    ["chat", "followed-threads", wsId, unread] as const,
  messageLinks: (wsId: string, messageId: string) =>
    ["chat", "message-links", wsId, messageId] as const,
  /** One room's timeline asks for the links of every loaded message at once. */
  roomMessageLinks: (wsId: string, roomId: string, messageIds: string) =>
    ["chat", "room-message-links", wsId, roomId, messageIds] as const,
  /** Prefix — any link change refreshes the batched room lookups. */
  roomMessageLinksRoot: (wsId: string) => ["chat", "room-message-links", wsId] as const,
  /** Prefix for all Follow-up list variants; invalidate with this key only. */
  followUps: (wsId: string) => ["chat", "follow-ups", wsId] as const,
  /** An attachment's bytes, cached so a remounted row does not fetch them again. */
  fileBlob: (wsId: string, roomId: string, messageId: string) =>
    ["chat", "file-blob", wsId, roomId, messageId] as const,
  voiceBlob: (wsId: string, roomId: string, messageId: string) =>
    ["chat", "voice-blob", wsId, roomId, messageId] as const,
  roomMessageSearch: (wsId: string, roomId: string, query: string) =>
    ["chat", "room-message-search", wsId, roomId, query] as const,
  roomMembers: (wsId: string, roomId: string) => ["chat", "room-members", wsId, roomId] as const,
  lookup: (wsId: string, email: string) => ["chat", "lookup", wsId, email] as const,
  block: (wsId: string, userId: string) => ["chat", "block", wsId, userId] as const,
  nicknames: (wsId: string) => ["chat", "nicknames", wsId] as const,
  gifs: (wsId: string, query: string) => ["chat", "gifs", wsId, query] as const,
  trendingGifs: (wsId: string) => ["chat", "gifs-trending", wsId] as const,
  stickers: (wsId: string, query: string) => ["chat", "stickers", wsId, query] as const,
  mediaStatus: (wsId: string) => ["chat", "media-status", wsId] as const,
  voiceRecordings: (wsId: string, roomId: string) =>
    ["chat", "voice-recordings", wsId, roomId] as const,
};
