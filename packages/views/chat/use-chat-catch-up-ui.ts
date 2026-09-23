"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAiCapabilities, useChatCatchUp } from "@uniwork/core/ai";
import { chatKeys, useMarkChatRoomRead } from "@uniwork/core/chat";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatCatchUpResponse } from "@uniwork/core/types";

const KNOWN = new Set([
  "ai_quota_exceeded",
  "ai_rate_limited",
  "ai_disabled",
  "ai_context_forbidden",
  "ai_output_invalid",
  "ai_provider_error",
]);

function errorMessage(err: unknown, t: (key: string) => string): string {
  const code = (err as { code?: unknown; message?: unknown } | null)?.code;
  const message = (err as { message?: unknown } | null)?.message;
  const candidate = typeof code === "string" ? code : typeof message === "string" ? message : "";
  if (KNOWN.has(candidate)) return t(`ai.errors.${candidate}`);
  return t("chat.ai.catch_up_failed");
}

/*
 * The catch-up API returns no generation timestamp, so the moment the
 * response reached the client stands in for it. Keyed by the response object
 * so the sheet can read it without another prop threaded through the page.
 */
const generatedAtByResult = new WeakMap<ChatCatchUpResponse, number>();

/** When this brief was generated (client receive time), or null if unknown. */
export function catchUpGeneratedAt(result: ChatCatchUpResponse | null): number | null {
  return result ? (generatedAtByResult.get(result) ?? null) : null;
}

/** Clear sidebar badge without replacing the array when already zero. */
function clearLocalUnread(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  roomId: string,
) {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) => {
    if (!old) return old;
    const room = old.find((entry) => entry.id === roomId);
    if (!room || ((room.unread_count ?? 0) <= 0 && (room.mention_unread_count ?? 0) <= 0)) {
      return old;
    }
    return old.map((entry) =>
      entry.id === roomId ? { ...entry, unread_count: 0, mention_unread_count: 0 } : entry,
    );
  });
}

/**
 * CatchUp sheet + header button for the active room (C-13.7).
 * Messages load with mark_read=0 so opening an unread room does not clear the
 * CatchUp window; we advance last_read when leaving the room or closing CatchUp.
 */
export function useChatCatchUpUi(workspaceId: string, roomId: string | null, threadRootId?: string | null) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const caps = useAiCapabilities(workspaceId);
  const catchUp = useChatCatchUp(workspaceId);
  const markRead = useMarkChatRoomRead(workspaceId);
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ChatCatchUpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevRoomRef = useRef<string | null>(null);

  const enabled = Boolean(caps.data?.enabled && caps.data.ask_uni && roomId);

  const flushRead = useCallback((id: string | null) => {
    if (!id) return;
    void markReadRef.current.mutateAsync(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    const prev = prevRoomRef.current;
    if (prev && prev !== roomId) {
      flushRead(prev);
    }
    prevRoomRef.current = roomId;
    // Hide badge while viewing; server last_read stays until flushRead.
    if (roomId) clearLocalUnread(qc, workspaceId, roomId);
  }, [flushRead, qc, roomId, workspaceId]);

  const run = useCallback(async () => {
    if (!roomId) return;
    setOpen(true);
    setError(null);
    setResult(null);
    try {
      const res = await catchUp.mutateAsync({
        room_id: roomId,
        thread_root_id: threadRootId || undefined,
        locale: i18n.language?.startsWith("en") ? "en" : "vi",
      });
      generatedAtByResult.set(res, Date.now());
      setResult(res);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }, [catchUp, i18n.language, roomId, t, threadRootId]);

  // Closing counts as "caught up" only when a brief was actually shown; a
  // failed or still-loading summary leaves the unread window for next time.
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next && result) flushRead(roomId);
    },
    [flushRead, result, roomId],
  );

  return {
    enabled,
    open,
    setOpen: onOpenChange,
    loading: catchUp.isPending,
    error,
    result,
    onCatchUp: enabled ? () => void run() : undefined,
    onRetry: () => void run(),
  };
}
