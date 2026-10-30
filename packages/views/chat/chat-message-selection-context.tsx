"use client";

import { createContext, useContext } from "react";
import type { ChatMessage } from "./chat-messages";

/** Multi-select UI shared by the timeline rows and message menus (Telegram-style). */
export type ChatMessageSelectionUi = {
  active: boolean;
  selectedIds: ReadonlySet<string>;
  enter: (message: ChatMessage) => void;
  toggle: (messageId: string) => void;
  clear: () => void;
  copySelected: () => void;
  forwardSelected: () => void;
  deleteSelected: () => void;
  createTaskSelected: () => void;
  /** At least one selected message is forwardable. */
  canForwardSelected: boolean;
  /** At least one selected message is the viewer's own (deletable). */
  canDeleteSelected: boolean;
  /** Create-task-from-chat is available in this room. */
  canCreateTaskSelected: boolean;
};

export const ChatMessageSelectionContext = createContext<ChatMessageSelectionUi | null>(null);

export function useChatMessageSelectionUi(): ChatMessageSelectionUi | null {
  return useContext(ChatMessageSelectionContext);
}
