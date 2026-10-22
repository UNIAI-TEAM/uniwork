import { CHAT_WALL_DOT_CLASS } from "@uniwork/core/chat/chat-wallpaper-resolve";

/**
 * Default dotted chat wall (static callers that do not read the wallpaper store).
 * Prefer `useChatWall()` in conversation UI.
 */
export const CHAT_WALL = CHAT_WALL_DOT_CLASS;

/** Horizontal inset for the open room's timeline and composer (full column width). */
export const CHAT_CONVERSATION_GUTTER = "px-3 sm:px-5 lg:px-8";
