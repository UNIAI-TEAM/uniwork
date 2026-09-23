"use client";

import { useEffect, useState } from "react";
import { useChatFileBlob } from "@uniwork/core/chat";

export type ChatFilePreviewStatus = "idle" | "loading" | "ready" | "error";

/**
 * An object URL for a file message's bytes. The bytes come from the shared
 * query cache (keyed by message), so a row that remounts — the virtual list
 * scrolling it back in, the timeline rebuilding — reads them from memory; the
 * URL itself belongs to this mount and is revoked when it goes.
 */
export function useChatFileObjectUrl(
  workspaceId: string,
  roomId: string,
  messageId: string,
  enabled: boolean,
): { url: string | null; status: ChatFilePreviewStatus } {
  const query = useChatFileBlob(workspaceId, roomId, messageId, enabled);
  const blob = query.data ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  const status: ChatFilePreviewStatus = !enabled
    ? "idle"
    : query.isError
      ? "error"
      : url
        ? "ready"
        : "loading";
  return { url, status };
}
