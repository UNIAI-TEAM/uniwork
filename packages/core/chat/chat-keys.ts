export const chatKeys = {
  room: (wsId: string) => ["chat", "room", wsId] as const,
  rooms: (wsId: string) => ["chat", "rooms", wsId] as const,
  channels: (wsId: string, scope: string, projectId = "", q = "") =>
    ["chat", "channels", wsId, scope, projectId, q] as const,
  projectChannels: (wsId: string, projectId: string) =>
    ["chat", "project-channels", wsId, projectId] as const,
  messages: (wsId: string) => ["chat", "messages", wsId] as const,
  roomMessages: (wsId: string, roomId: string) => ["chat", "room-messages", wsId, roomId] as const,
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
};
