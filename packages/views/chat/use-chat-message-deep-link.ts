"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";

/** Names one message in the room `?room=` opens: where a notification about it lands. */
const MESSAGE_PARAM = "message";
const ROOM_PARAM = "room";

/**
 * `/chat?room=<roomId>&message=<messageId>` opens the room (use-chat-room-url
 * does that) and then scrolls to the message and highlights it, the same jump
 * a search result makes. The message param is dropped from the URL once used,
 * so a reload or a later room switch does not jump again; it is dropped too
 * when the room it belongs to is not the one that opened (gone, or no access).
 *
 * Call it after the page's own "room changed" reset, so the reset of that
 * same commit cannot clear the jump this sets.
 */
export function useChatMessageDeepLink({
  activeRoomId,
  roomsReady,
  onJump,
}: {
  activeRoomId: string | null;
  roomsReady: boolean;
  onJump: (messageId: string) => void;
}): void {
  const nav = useOptionalNavigation();
  const messageId = nav?.searchParams.get(MESSAGE_PARAM) ?? "";
  const roomId = nav?.searchParams.get(ROOM_PARAM) ?? "";
  // The room the link named when the message first appeared: a room that
  // cannot open is replaced in the URL by the fallback room, and the message
  // must not be looked for there.
  const intended = useRef<{ messageId: string; roomId: string } | null>(null);
  const handled = useRef<string | null>(null);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;

  useEffect(() => {
    if (!nav || !messageId || handled.current === messageId || !roomsReady) return;
    if (intended.current?.messageId !== messageId) intended.current = { messageId, roomId };
    const target = intended.current.roomId;
    const opened = Boolean(target) && activeRoomId === target;
    // Still opening the named room: wait for it.
    if (!opened && target && roomId === target) return;
    handled.current = messageId;
    if (opened) jumpRef.current(messageId);
    const params = new URLSearchParams(nav.searchParams);
    params.delete(MESSAGE_PARAM);
    const qs = params.toString();
    nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
  }, [activeRoomId, messageId, nav, roomId, roomsReady]);
}
