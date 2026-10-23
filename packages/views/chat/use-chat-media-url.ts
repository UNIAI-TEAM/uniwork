"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isChatMediaUrlFresh, useRefreshChatMessageMedia } from "@uniwork/core/chat";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";

export type ChatMediaStatus = "idle" | "loading" | "ready" | "error";

/**
 * A signed storage URL (UNI-1633) to put in an element's src. The message
 * list carries it; a URL past its expiry, or one the element fails to load,
 * asks the server once for the message again, and the refreshed message
 * flows back in through the room cache. A message with no URL at all (the
 * server could not sign one) is an error, not a retry loop.
 */
export function useChatMediaSrc(
  workspaceId: string,
  roomId: string,
  messageId: string,
  url: string | undefined,
  expiresAt: string | undefined,
  enabled = true,
): { src: string | null; status: ChatMediaStatus; onError: () => void } {
  const refresh = useRefreshChatMessageMedia(workspaceId, roomId);
  const [renewing, setRenewing] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // The URL a renewal was already asked for; a second failure of the same
  // URL means the server has nothing better to give.
  const renewedFor = useRef<string | null>(null);
  const fresh = isChatMediaUrlFresh(url, expiresAt);

  const renew = useCallback(() => {
    if (!url) return;
    if (renewedFor.current === url) {
      setFailedUrl(url);
      return;
    }
    renewedFor.current = url;
    setRenewing(true);
    refresh(messageId)
      .catch(() => setFailedUrl(url))
      .finally(() => setRenewing(false));
  }, [messageId, refresh, url]);

  useEffect(() => {
    if (enabled && url && !fresh) renew();
  }, [enabled, fresh, renew, url]);

  const status: ChatMediaStatus = !enabled
    ? "idle"
    : !url || failedUrl === url
      ? "error"
      : fresh && !renewing
        ? "ready"
        : "loading";
  return { src: status === "ready" ? (url ?? null) : null, status, onError: renew };
}

/**
 * A signed URL for a click (download, open the original, play): the one the
 * message carries while it is fresh, otherwise the one the server signs now.
 * Rejects when the server signs none.
 */
export function useFreshChatMediaUrl(workspaceId: string, roomId: string) {
  const refresh = useRefreshChatMessageMedia(workspaceId, roomId);
  return useCallback(
    async (
      messageId: string,
      current: { url: string | undefined; expiresAt: string | undefined },
      pick: (fresh: ChatMessageRecord) => string | undefined,
    ): Promise<string> => {
      if (current.url && isChatMediaUrlFresh(current.url, current.expiresAt)) return current.url;
      const fresh = await refresh(messageId);
      const url = fresh ? pick(fresh) : undefined;
      if (!url) throw new Error("chat media URL unavailable");
      return url;
    },
    [refresh],
  );
}
