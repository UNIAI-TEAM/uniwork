/**
 * The chat wall: the tinted field with its dot grid that every conversation
 * (and its empty and loading panes) sits on. Spelled out once so Tailwind
 * sees the classes and every pane draws the same wall.
 */
export const CHAT_WALL =
  "bg-chat-wall bg-[radial-gradient(var(--chat-wall-dot)_1.2px,transparent_1.4px)] bg-size-[22px_22px]";

/** Horizontal inset for the open room's timeline and composer (full column width). */
export const CHAT_CONVERSATION_GUTTER = "px-3 sm:px-5 lg:px-8";
