// Signed media URLs for a message, mirroring packages/views/chat/use-chat-media-url.ts:
// storage URLs are presigned per viewer, so no bearer is needed,
// but they expire. A URL past its expiry asks the server once for the
// message again; the fresh copy flows back through the room cache. A photo
// (useChatImageSrc) keeps drawing while it waits: its disk cache is keyed by
// message and variant, not by URL (lib/media-source.ts), so a photo seen
// before shows at once, offline included, and the asks of one room go
// together (data/media-refresh.ts).
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { refreshMessageMedia } from "@/data/chat-cache";
import { requestMediaRefresh } from "@/data/media-refresh";
import { isChatMediaUrlFresh } from "@/lib/message-display";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";

/** Asks once per expired URL for the message's fresh ones (with the room's other asks); a second miss means the server has nothing better. */
function useRenewal(wsId: string, roomId: string, messageId: string, url: string | undefined, fresh: boolean): void {
  const qc = useQueryClient();
  const renewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!url || fresh || renewedFor.current === url) return;
    renewedFor.current = url;
    requestMediaRefresh(qc, wsId, roomId, messageId);
  }, [fresh, messageId, qc, roomId, url, wsId]);
}

/** A URL to play or open now, or null while a fresh one is asked for (or none exists). */
export function useChatMediaSrc(wsId: string, roomId: string, messageId: string, url: string | undefined, expiresAt: string | undefined) {
  const fresh = isChatMediaUrlFresh(url, expiresAt);
  useRenewal(wsId, roomId, messageId, url, fresh);
  return fresh ? (url as string) : null;
}

/**
 * A photo's URL to draw now: the signed one, even past its expiry. Expired, the image is drawn from the
 * device's cache under its stable key when it was seen before (the network is not asked), and the room's
 * fresh URLs are asked for together; a photo never seen waits for them on its grey box.
 */
export function useChatImageSrc(wsId: string, roomId: string, messageId: string, url: string | undefined, expiresAt: string | undefined) {
  useRenewal(wsId, roomId, messageId, url, isChatMediaUrlFresh(url, expiresAt));
  return url ?? null;
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
