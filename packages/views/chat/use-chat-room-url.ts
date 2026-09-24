"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOptionalNavigation } from "../navigation";

const ROOM_PARAM = "room";
/** Opens a one-to-one conversation by person, from outside Chat (the directory). */
export const DM_PARAM = "dm";
/** The list and the conversation sit side by side from lg; below it they swap. */
const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readWide(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(WIDE_QUERY).matches;
}

/** True when the list and the conversation are both on screen (lg and up). */
export function useChatWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, () => true);
}

/**
 * The open conversation lives in the URL as `?room=<id>`, so a reload lands
 * back in it and a link to it can be shared. On a phone the list and the
 * conversation are two screens: opening a room pushes a history entry, so
 * the system Back (Android, browser) returns to the list, and a Back from
 * there leaves chat. On a wide screen switching rooms replaces the entry —
 * the list is always beside it, so history would only fill with rooms.
 *
 * Without a navigation provider (isolated mounts, tests) the same state is
 * kept locally, with no history.
 */
export function useChatRoomUrl({
  activeRoomId,
  wide,
  resolveRoom,
  roomsReady,
}: {
  activeRoomId: string | null;
  wide: boolean;
  /** Opens the room named in the URL; false when no known room has that id. */
  resolveRoom: (roomId: string) => boolean;
  /** Rooms have loaded, so a room the URL names but nobody knows is really gone. */
  roomsReady: boolean;
}) {
  const nav = useOptionalNavigation();
  const [localRoom, setLocalRoom] = useState<string | null>(null);
  const roomParam = nav ? nav.searchParams.get(ROOM_PARAM) : localRoom;
  const deepLinked = Boolean(nav?.searchParams.get(DM_PARAM));
  // A DM without a room yet: the conversation opens now, the URL follows
  // when the room id arrives.
  const [pendingOpen, setPendingOpen] = useState(false);
  // The value this hook last wrote (or applied): a URL change equal to it is
  // our own echo, not a navigation to follow.
  const handledRef = useRef<string | null | undefined>(undefined);
  const pushedRef = useRef(false);

  const write = useCallback(
    (roomId: string | null, mode: "push" | "replace", keepDeepLink = false) => {
      handledRef.current = roomId;
      if (!nav) {
        setLocalRoom(roomId);
        return;
      }
      const params = new URLSearchParams(nav.searchParams);
      // A `?dm=` deep link (see use-chat-dm-deep-link) stays while its own DM
      // is what is open — that DM has no message yet, so it is not in the room
      // list and `?room=` alone cannot bring it back after a remount. Any
      // other room the reader moves to drops it.
      if (!keepDeepLink) params.delete(DM_PARAM);
      if (roomId) params.set(ROOM_PARAM, roomId);
      else params.delete(ROOM_PARAM);
      const qs = params.toString();
      const href = qs ? `${nav.pathname}?${qs}` : nav.pathname;
      if (mode === "push") {
        pushedRef.current = true;
        nav.push(href);
      } else {
        nav.replace(href);
      }
    },
    [nav],
  );

  // URL → conversation: a reload, a shared link, Back/Forward.
  const resolveRef = useRef(resolveRoom);
  resolveRef.current = resolveRoom;
  useEffect(() => {
    if (roomParam === handledRef.current) return;
    if (!roomParam) {
      handledRef.current = null;
      pushedRef.current = false;
      return;
    }
    if (roomParam === activeRoomId) {
      handledRef.current = roomParam;
      return;
    }
    // The deep link opens its DM itself; an empty DM is not a known room, and
    // resolving it here would drop it as gone.
    if (deepLinked) return;
    if (resolveRef.current(roomParam)) {
      handledRef.current = roomParam;
    } else if (roomsReady) {
      // A room that is gone (left, deleted, never ours): drop it from the URL.
      write(null, "replace");
    }
    // activeRoomId is read, not followed: a click changes it before the URL
    // catches up, and following it here would undo the click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomParam, roomsReady, deepLinked, write]);

  // Conversation → URL for changes that did not start at the URL or a click:
  // a DM room that just resolved, a group just created, a room left.
  const prevActiveRef = useRef(activeRoomId);
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeRoomId;
    if (!activeRoomId || activeRoomId === roomParam || activeRoomId === handledRef.current) {
      if (activeRoomId && pendingOpen) setPendingOpen(false);
      return;
    }
    const fromList = !wide && !roomParam;
    if (pendingOpen) {
      setPendingOpen(false);
      write(activeRoomId, fromList ? "push" : "replace", deepLinked);
      return;
    }
    // The first room to appear (the workspace room on load) is a default,
    // not a navigation: the phone keeps its list, the URL stays clean.
    if (prev === null || prev === activeRoomId) return;
    write(activeRoomId, fromList ? "push" : "replace");
  }, [activeRoomId, deepLinked, pendingOpen, roomParam, wide, write]);

  /** A row was chosen: show that room (and on a phone, its screen). */
  const openRoom = useCallback(
    (roomId: string | null) => {
      const fromList = !wide && !roomParam;
      if (!roomId) {
        setPendingOpen(true);
        return;
      }
      setPendingOpen(false);
      if (roomId === roomParam) return;
      write(roomId, fromList ? "push" : "replace");
    },
    [roomParam, wide, write],
  );

  /** The phone's back control: the history entry we pushed, else a replace. */
  const backToList = useCallback(() => {
    setPendingOpen(false);
    if (nav && pushedRef.current) {
      pushedRef.current = false;
      handledRef.current = null;
      nav.back();
      return;
    }
    write(null, "replace");
  }, [nav, write]);

  /** On a phone: is the conversation screen the one showing? */
  const conversationOpen = Boolean(roomParam) || pendingOpen;
  return { roomParam, conversationOpen, openRoom, backToList };
}
