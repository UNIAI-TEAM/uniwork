// Signed media URLs for a message, mirroring packages/views/chat/use-chat-media-url.ts:
// storage URLs are presigned per viewer (UNI-1633), so no bearer is needed,
// but they expire. A URL past its expiry asks the server once for the
// message again; the fresh copy flows back through the room cache.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { refreshMessageMedia } from "@/data/chat-actions";
import { isChatMediaUrlFresh } from "@/lib/message-display";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";

/** A URL to show now, or null while a fresh one is asked for (or none exists). */
export function useChatMediaSrc(wsId: string, roomId: string, messageId: string, url: string | undefined, expiresAt: string | undefined) {
  const qc = useQueryClient();
  const fresh = isChatMediaUrlFresh(url, expiresAt);
  // The URL a renewal was already asked for: a second miss means the server has nothing better.
  const renewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!url || fresh || renewedFor.current === url) return;
    renewedFor.current = url;
    void refreshMessageMedia(qc, wsId, roomId, messageId).catch(() => undefined);
  }, [fresh, messageId, qc, roomId, url, wsId]);
  return fresh ? (url as string) : null;
}

/** A signed URL for a tap (open a file, play a voice message): the current one while fresh, else one signed now. */
export function useFreshChatMediaUrl(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (
      messageId: string,
      current: { url: string | undefined; expiresAt: string | undefined },
      pick: (fresh: ChatMessageRecord) => string | undefined,
    ): Promise<string> => {
      if (current.url && isChatMediaUrlFresh(current.url, current.expiresAt)) return current.url;
      const fresh = await refreshMessageMedia(qc, wsId, roomId, messageId);
      const url = fresh ? pick(fresh) : undefined;
      if (!url) throw new Error("chat media URL unavailable");
      return url;
    },
    [qc, roomId, wsId],
  );
}
