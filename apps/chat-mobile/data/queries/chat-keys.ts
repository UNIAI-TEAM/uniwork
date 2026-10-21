// The mobile chat's query keys: the chat tab, the calls tab and the people the
// two name. Its own factory (ADR 0011 §3: the web's chatKeys sits behind
// web-only modules). Every key but the account-wide unread summary carries
// the workspace id right after "chat", so one workspace's chat drops with a
// single prefix; data/queries/keys.test.ts holds that, and no key may nest
// under another's prefix (a preview under room-messages was read as a room
// timeline by every patch of that prefix).
export const chatKeys = {
  rooms: (wsId: string) => ["chat", wsId, "rooms"] as const,
  /** Unread per workspace for the signed-in person (every workspace at once: the switch and the pill badge). */
  unreadSummary: () => ["chat", "unread-summary"] as const,
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
  /** Prefix: every loaded thread of the workspace (reconnect). */
  threadsRoot: (wsId: string) => ["chat", wsId, "thread-messages"] as const,
  roomMembers: (wsId: string, roomId: string) => ["chat", wsId, "room-members", roomId] as const,
  roomSearch: (wsId: string, roomId: string, q: string) => ["chat", wsId, "room-search", roomId, q] as const,
  discoverableChannels: (wsId: string) => ["chat", wsId, "channels", "discoverable"] as const,
  /** The channels the reader is in, for the directory's "Đã tham gia" rows. */
  myChannels: (wsId: string) => ["chat", wsId, "channels", "mine"] as const,
  sharedSummary: (wsId: string, roomId: string) => ["chat", wsId, "shared-summary", roomId] as const,
  /** A list row's long-press preview: the room's last few messages, never patched, refetched when stale. */
  roomPreview: (wsId: string, roomId: string) => ["chat", wsId, "room-preview", roomId] as const,
  nicknames: (wsId: string) => ["chat", wsId, "nicknames"] as const,
  /** The workspace's members (GET /workspaces/{ws}/members): contacts, the DM and group pickers, mentions. */
  members: (wsId: string) => ["chat", wsId, "members"] as const,
  /** The calls tab: the workspace's call logs, newest first (one infinite query). */
  callLogs: (wsId: string) => ["chat", wsId, "call-logs"] as const,
  /** Whether a live call is being recorded, polled while it is on screen. */
  callRecording: (wsId: string, roomId: string, callId: string) => ["chat", wsId, "call-recording", roomId, callId] as const,
  // M3 rich kinds.
  /** This person's follow-ups in the workspace, done ones included. */
  followUps: (wsId: string) => ["chat", wsId, "follow-ups"] as const,
  /** The task links of one window of the messages a room shows (lib/link-windows.ts). */
  roomLinks: (wsId: string, roomId: string, messageIds: readonly string[]) => ["chat", wsId, "message-links", roomId, messageIds.join(",")] as const,
  /** Prefix: every link list of one room. */
  roomLinksRoot: (wsId: string, roomId: string) => ["chat", wsId, "message-links", roomId] as const,
  task: (wsId: string, taskId: string) => ["chat", wsId, "task", taskId] as const,
  expressions: (wsId: string, kind: "stickers" | "gifs", q: string) => ["chat", wsId, "expressions", kind, q] as const,
  /** Whether the reader and one person block each other (DM info, the DM's banner, a member's menu). */
  blockStatus: (wsId: string, userId: string) => ["chat", wsId, "block", userId] as const,
};
