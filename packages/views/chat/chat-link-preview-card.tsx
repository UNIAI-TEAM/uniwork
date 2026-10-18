"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChatLinkPreview } from "@uniwork/core/api/endpoints/chat-link-previews";
import { isChatMediaUrlFresh, useChatRoomLinkPreviews } from "@uniwork/core/chat";
import { cn } from "@uniwork/ui/lib/utils";

const ChatLinkPreviewsContext = createContext<ReadonlyMap<string, ChatLinkPreview> | null>(null);

/**
 * The timeline asks for the link cards of every loaded message with a link in
 * one request and hands them down here, as it does the task links.
 */
export function ChatLinkPreviewsProvider({
  workspaceId,
  roomId,
  messages,
  children,
}: {
  workspaceId: string;
  roomId: string;
  messages: readonly { id: string; body: string }[];
  children: ReactNode;
}) {
  const previews = useChatRoomLinkPreviews(workspaceId, roomId, messages);
  return <ChatLinkPreviewsContext.Provider value={previews}>{children}</ChatLinkPreviewsContext.Provider>;
}

export function useChatLinkPreviewFor(messageId: string): ChatLinkPreview | null {
  return useContext(ChatLinkPreviewsContext)?.get(messageId) ?? null;
}

/**
 * The card of the first link in a message, inside its bubble under the text
 * (canvas WebMessageKinds): a soft fill with a brand bar, the site, the title,
 * two lines of description and the page's picture. The server read the page
 * and keeps the picture (ADR 0035), so drawing it never calls the site. On my
 * brand bubble it takes the bubble's own white, as a reply quote does.
 */
export function ChatLinkPreviewCard({ preview, isOwn }: { preview: ChatLinkPreview; isOwn: boolean }) {
  const href = /^https?:\/\//i.test(preview.url) ? preview.url : undefined;
  const image = isChatMediaUrlFresh(preview.image_url, preview.image_url_expires_at) ? preview.image_url : undefined;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-2 mb-0.5 flex gap-3 rounded-lg border-l-3 py-2.5 pr-2.5 pl-2.5 transition-[filter] duration-(--duration-fast) hover:brightness-95",
        // The soft fill of CHAT_ON_BUBBLE_FILL on theirs.
        isOwn
          ? "border-chat-bubble-own-foreground bg-chat-bubble-own-foreground/15"
          : "border-brand bg-muted dark:bg-foreground/8",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {preview.site_name ? (
          <span className={cn("truncate text-caption font-semibold", isOwn ? "text-chat-bubble-own-foreground" : "text-brand")}>
            {preview.site_name}
          </span>
        ) : null}
        {preview.title ? (
          <span
            className={cn(
              "line-clamp-2 font-display text-body font-bold",
              isOwn ? "text-chat-bubble-own-foreground" : "text-foreground",
            )}
          >
            {preview.title}
          </span>
        ) : null}
        {preview.description ? (
          <span className={cn("line-clamp-2 text-label", isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>
            {preview.description}
          </span>
        ) : null}
      </span>
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" className="size-21 shrink-0 rounded-control object-cover" />
      ) : null}
    </a>
  );
}
