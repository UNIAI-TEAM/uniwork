"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChatMessageLinkRecord } from "@uniwork/core/api/endpoints/chat-links";

type ChatMessageLinksValue = {
  linksByMessageId: ReadonlyMap<string, ChatMessageLinkRecord[]>;
  /** Mirrors the server: unlinking needs the right to write in the room. */
  canUnlink: boolean;
};

const ChatMessageLinksContext = createContext<ChatMessageLinksValue | null>(null);
const NO_LINKS: ChatMessageLinkRecord[] = [];

/**
 * The timeline fetches every loaded message's links in one request and hands
 * them down here, so a task card under a message reads its links instead of
 * asking the server for them itself.
 */
export function ChatMessageLinksProvider({ value, children }: { value: ChatMessageLinksValue; children: ReactNode }) {
  return <ChatMessageLinksContext.Provider value={value}>{children}</ChatMessageLinksContext.Provider>;
}

export function useChatMessageLinksFor(messageId: string): { links: ChatMessageLinkRecord[]; canUnlink: boolean } {
  const value = useContext(ChatMessageLinksContext);
  return {
    links: value?.linksByMessageId.get(messageId) ?? NO_LINKS,
    canUnlink: value?.canUnlink ?? false,
  };
}
