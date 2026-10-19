"use client";

import { useEffect } from "react";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { useOptionalNavigation } from "../navigation";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

/**
 * Chat shows one scope at a time. `messages` holds DMs and groups, which
 * belong to the organization and so are the same in every workspace;
 * `workspace` holds this workspace's room and channels. Listed together, the
 * same DMs and groups repeated in every workspace's list and nobody could
 * tell where they were.
 */
export type ChatScope = "messages" | "workspace";

/**
 * `?view=messages|channels` is a one-shot instruction from the rail or the
 * scope switch. Any room the page writes to the URL drops it
 * (use-chat-room-url): from then on the open room's kind is the scope.
 */
export const CHAT_VIEW_PARAM = "view";

export function isDirectRoomKind(kind: string | undefined): boolean {
  return kind === "dm" || kind === "group";
}

/** The scope a chat URL shows: the explicit view, else the kind of the room it names. */
export function chatScopeOf(view: string | null, roomKind: string | undefined): ChatScope {
  if (view === "messages") return "messages";
  if (view === "channels") return "workspace";
  return isDirectRoomKind(roomKind) ? "messages" : "workspace";
}

/** The DM or group with the latest message: what the messages scope opens on. */
function mostRecentDirect(
  rooms: readonly ChatRoomRecord[],
  contacts: readonly ChatContact[],
  groups: readonly GroupChat[],
): ChatSidebarTarget | null {
  const at = (room: ChatRoomRecord) => Date.parse(room.last_message_at ?? "") || 0;
  const ordered = rooms.filter((room) => isDirectRoomKind(room.kind)).sort((a, b) => at(b) - at(a));
  for (const room of ordered) {
    if (room.kind === "group") {
      const group = groups.find((entry) => entry.room_id === room.id);
      if (group) return { kind: "group", group };
    } else {
      const contact = contacts.find((entry) => entry.dm_room_id === room.id);
      if (contact) return { kind: "dm", contact };
    }
  }
  return null;
}

/**
 * The scope the page shows, and the open room kept inside it: `?view=channels`
 * closes a DM or group for the workspace room; `?view=messages` opens the most
 * recent DM or group, or nothing when there is none yet. While the open room
 * is outside the scope, the page opens no room (`mismatch`), so nothing is
 * marked read behind an empty pane.
 */
export function useChatScope({
  target,
  setTarget,
  rooms,
  roomsReady,
  contacts,
  groups,
}: {
  target: ChatSidebarTarget;
  setTarget: (target: ChatSidebarTarget) => void;
  rooms: readonly ChatRoomRecord[];
  roomsReady: boolean;
  contacts: readonly ChatContact[];
  groups: readonly GroupChat[];
}): { scope: ChatScope; mismatch: boolean } {
  const view = useOptionalNavigation()?.searchParams.get(CHAT_VIEW_PARAM) ?? null;
  const direct = isDirectRoomKind(target.kind);
  const scope = chatScopeOf(view, target.kind);

  useEffect(() => {
    if (view === "channels" && direct) {
      setTarget({ kind: "workspace" });
      return;
    }
    if (view !== "messages" || direct || !roomsReady) return;
    const next = mostRecentDirect(rooms, contacts, groups);
    if (next) setTarget(next);
  }, [view, direct, roomsReady, rooms, contacts, groups, setTarget]);

  return { scope, mismatch: (scope === "messages") !== direct };
}
