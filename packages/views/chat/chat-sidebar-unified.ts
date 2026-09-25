import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import {
  comparePinnedRoomOrder,
  type ChatRoomPreference,
} from "@uniwork/core/chat/room-preferences-store";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import { compareRoomPreviewRecency } from "./chat-sidebar-preview";
import { foldedIncludes } from "./chat-search-fold";

export type ChatSidebarKindFilter = "all" | "workspace" | "channel" | "group" | "dm";

export type UnifiedSidebarEntry =
  | { key: string; kind: "workspace"; roomId: string | null; sortRoomId: string }
  | { key: string; kind: "channel"; channel: ChatRoomRecord; sortRoomId: string }
  | { key: string; kind: "group"; group: GroupChat; sortRoomId: string }
  | { key: string; kind: "dm"; contact: ChatContact; sortRoomId: string };

/**
 * The kinds a reader filters by. The workspace room is not one of them: it is
 * a single room that "All" always lists, so a filter for it only ever showed
 * one row and pushed the control onto a second line.
 */
export function chatSidebarFilterOptions(): ChatSidebarKindFilter[] {
  return ["all", "dm", "group", "channel"];
}

/** Accent-insensitive: "tuan" finds "Tuấn", "thiet ke" finds "Thiết kế". */
function matchesText(text: string, filter: string): boolean {
  return foldedIncludes(text, filter);
}

/** Flat conversation list sorted like Zalo/Messages (pin → recent). */
export function buildUnifiedSidebarEntries(input: {
  kindFilter: ChatSidebarKindFilter;
  filterText: string;
  workspaceTitle: string;
  workspaceRoomId: string | null;
  channels: ChatRoomRecord[];
  groups: GroupChat[];
  contacts: ChatContact[];
  nicknamesByUserId: Record<string, string>;
  roomPreviewsByRoomId: Record<string, ChatRoomPreview>;
  pinnedByRoomId: Record<string, ChatRoomPreference>;
}): UnifiedSidebarEntry[] {
  const {
    kindFilter,
    filterText,
    workspaceTitle,
    workspaceRoomId,
    channels,
    groups,
    contacts,
    nicknamesByUserId,
    roomPreviewsByRoomId,
    pinnedByRoomId,
  } = input;

  const entries: UnifiedSidebarEntry[] = [];

  const include = (kind: ChatSidebarKindFilter) =>
    kindFilter === "all" || kindFilter === kind;

  if (include("workspace") && matchesText(workspaceTitle, filterText)) {
    entries.push({
      key: "workspace",
      kind: "workspace",
      roomId: workspaceRoomId,
      sortRoomId: workspaceRoomId ?? "",
    });
  }

  if (include("channel")) {
    for (const channel of channels) {
      if (
        !matchesText(channel.name, filterText) &&
        !matchesText(channel.topic ?? "", filterText)
      ) {
        continue;
      }
      entries.push({
        key: `channel:${channel.id}`,
        kind: "channel",
        channel,
        sortRoomId: channel.id,
      });
    }
  }

  if (include("group")) {
    for (const group of groups) {
      if (!matchesText(group.name, filterText)) continue;
      entries.push({
        key: `group:${group.id}`,
        kind: "group",
        group,
        sortRoomId: group.room_id,
      });
    }
  }

  if (include("dm")) {
    for (const contact of contacts) {
      const label = displayLabelForChatContact(contact, nicknamesByUserId);
      if (!matchesText(label, filterText) && !matchesText(contact.email, filterText)) {
        continue;
      }
      entries.push({
        key: `dm:${contact.user_id}`,
        kind: "dm",
        contact,
        sortRoomId: contact.dm_room_id ?? "",
      });
    }
  }

  return entries.sort((a, b) => {
    const pinOrder = comparePinnedRoomOrder(a.sortRoomId, b.sortRoomId, pinnedByRoomId);
    if (pinOrder !== 0) return pinOrder;
    return compareRoomPreviewRecency(
      a.sortRoomId ? roomPreviewsByRoomId[a.sortRoomId] : null,
      b.sortRoomId ? roomPreviewsByRoomId[b.sortRoomId] : null,
    );
  });
}
