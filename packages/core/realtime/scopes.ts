/** Realtime scope types the server accepts on subscribe frames. */
export const WS_SCOPE_CHAT = "chat" as const;
/**
 * A meeting held open by its room or detail page. In-room events (chat,
 * transcript, the roll, motions, recordings, the lobby queue) are delivered
 * only on this scope, not to the whole workspace.
 */
export const WS_SCOPE_MEETING = "meeting" as const;
