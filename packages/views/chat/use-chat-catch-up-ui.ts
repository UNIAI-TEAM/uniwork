"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAiCapabilities, useChatCatchUp } from "@uniwork/core/ai";
import { chatKeys, useMarkChatRoomRead, useMarkChatThreadRead } from "@uniwork/core/chat";
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

/** The room's read pointer and unread count from the sidebar, while it still has unread messages. */
function unreadSinceOf(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  roomId: string,
): { roomId: string; since: string; count: number } | null {
  const room = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId))?.find((entry) => entry.id === roomId);
  const hasUnread = (room?.unread_count ?? 0) > 0 || (room?.mention_unread_count ?? 0) > 0;
  return hasUnread && room?.last_read_at ? { roomId, since: room.last_read_at, count: room.unread_count ?? 0 } : null;
}

/**
 * CatchUp sheet + header button for the active room (C-13.7).
 * Messages load with mark_read=0 so CatchUp can still use the pre-open cursor;
 * opening a room still calls MarkRoomRead so sidebar badges and peer receipts
 * match “đã xem”. CatchUp close also flushes read after a brief was shown.
 * Opening a thread marks it read here too, keeping the pointer it replaced.
 * The list's "Bắt kịp nhanh" asks for a room's brief before that room is
 * open (`requestCatchUp`); it runs once the room has opened and its pointer
 * is kept, so the brief starts where the reader left off.
 */
export function useChatCatchUpUi(workspaceId: string, roomId: string | null, threadRootId?: string | null) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const caps = useAiCapabilities(workspaceId);
  const catchUp = useChatCatchUp(workspaceId);
  const markRead = useMarkChatRoomRead(workspaceId);
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const markThreadRead = useMarkChatThreadRead(workspaceId);
  const markThreadReadRef = useRef(markThreadRead);
  markThreadReadRef.current = markThreadRead;
  const threadRootRef = useRef(threadRootId);
  threadRootRef.current = threadRootId;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ChatCatchUpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The read pointer as it was before this room opened (opening marks it
  // read): where "Tin mới" goes, and where the brief starts.
  const [unread, setUnread] = useState<{ roomId: string; since: string; count: number } | null>(null);
  const prevRoomRef = useRef<string | null>(null);
  // The room whose pointer is kept above, and a room whose brief waits for that.
  const [openedRoom, setOpenedRoom] = useState<string | null>(null);
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const lastRoomOnlyRef = useRef(false);
  // The same for the open thread; the server hands it back when marking read.
  const [threadUnread, setThreadUnread] = useState<{ rootId: string; since: string } | null>(null);

  const enabled = Boolean(caps.data?.enabled && caps.data.ask_uni && roomId);
  const unreadSince = unread?.roomId === roomId ? unread.since : null;
  const threadSince = threadRootId && threadUnread?.rootId === threadRootId ? threadUnread.since : null;

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
    setOpenedRoom(roomId);
    if (roomId) {
      setUnread(unreadSinceOf(qc, workspaceId, roomId));
      clearLocalUnread(qc, workspaceId, roomId);
      flushRead(roomId);
    }
  }, [flushRead, qc, roomId, workspaceId]);

  useEffect(() => {
    setThreadUnread(null);
    if (!threadRootId) return;
    markThreadReadRef.current
      .mutateAsync(threadRootId)
      .then((since) => {
        if (!since || threadRootRef.current !== threadRootId) return;
        // A double mark (StrictMode, a quick reopen) answers with the first
        // call's write; the earlier pointer is the one from before opening.
        setThreadUnread((prev) =>
          prev?.rootId === threadRootId && Date.parse(prev.since) <= Date.parse(since)
            ? prev
            : { rootId: threadRootId, since },
        );
      })
      .catch(() => undefined);
  }, [threadRootId]);

  // `roomOnly`: the room's brief even while a thread is open (the unread line's button).
  const run = useCallback(async (roomOnly: boolean) => {
    if (!roomId) return;
    lastRoomOnlyRef.current = roomOnly;
    const thread = roomOnly ? undefined : threadRootId || undefined;
    setOpen(true);
    setError(null);
    setResult(null);
    try {
      const res = await catchUp.mutateAsync({
        room_id: roomId,
        thread_root_id: thread,
        locale: i18n.language?.startsWith("en") ? "en" : "vi",
        since: (thread ? threadSince : unreadSince) ?? undefined,
      });
      generatedAtByResult.set(res, Date.now());
      setResult(res);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }, [catchUp, i18n.language, roomId, t, threadRootId, threadSince, unreadSince]);

  // shortcut: a request whose room never opens (AI off) waits until that room
  // does; the card only shows when AI is on, so it opens at once in practice.
  useEffect(() => {
    if (!enabled || !pendingRoom || pendingRoom !== roomId || openedRoom !== roomId) return;
    setPendingRoom(null);
    void run(true);
  }, [enabled, openedRoom, pendingRoom, roomId, run]);

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
    onCatchUp: enabled ? () => void run(false) : undefined,
    onCatchUpRoom: enabled ? () => void run(true) : undefined,
    onRetry: () => void run(lastRoomOnlyRef.current),
    /** Opens this room's brief once the room is open (call it with the room being opened). */
    requestCatchUp: setPendingRoom,
    unreadSince,
    /** How many messages were unread when the room opened, or null. */
    unreadCount: unread?.roomId === roomId ? unread.count : null,
  };
}
