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
import type { ChatScope } from "./chat-scope";

export type ChatSidebarKindFilter = "all" | "workspace" | "channel" | "group" | "dm";

/** UNI-515: narrow the list to rooms with unread or mention badges. */
export type ChatSidebarActivityFilter = "all" | "unread" | "mentions";

export type UnifiedSidebarEntry =
  | { key: string; kind: "workspace"; roomId: string | null; sortRoomId: string }
  | { key: string; kind: "channel"; channel: ChatRoomRecord; sortRoomId: string }
  | { key: string; kind: "group"; group: GroupChat; sortRoomId: string }
  | { key: string; kind: "dm"; contact: ChatContact; sortRoomId: string };

/**
 * The list's one tab row (canvas "Main"): the read-state filters first, then
 * the kinds. The workspace room has no tab of its own: "All" always lists it.
 */
export const CHAT_SIDEBAR_TABS = ["all", "unread", "mentions", "dm", "group", "channel"] as const;
export type ChatSidebarTab = (typeof CHAT_SIDEBAR_TABS)[number];

/** Each scope's tabs: a kind tab only where the scope holds two kinds to tell apart. */
export const CHAT_SIDEBAR_TABS_BY_SCOPE: Record<ChatScope, readonly ChatSidebarTab[]> = {
  messages: ["all", "unread", "mentions", "dm", "group"],
  workspace: ["all", "unread", "mentions"],
};

/** The kinds of room each scope lists (chat-scope.ts says why they are apart). */
export function kindInScope(scope: ChatScope, kind: UnifiedSidebarEntry["kind"]): boolean {
  return scope === "messages" ? kind === "dm" || kind === "group" : kind === "workspace" || kind === "channel";
}

/** A tab is one kind filter and one read-state filter. */
export function chatSidebarTabFilters(tab: ChatSidebarTab): {
  kindFilter: ChatSidebarKindFilter;
  activityFilter: ChatSidebarActivityFilter;
} {
  switch (tab) {
    case "unread":
    case "mentions":
      return { kindFilter: "all", activityFilter: tab };
    case "dm":
    case "group":
    case "channel":
      return { kindFilter: tab, activityFilter: "all" };
    default:
      return { kindFilter: "all", activityFilter: "all" };
  }
}

/**
 * The counts on the tabs, in conversations: "All" counts the ones with unread
 * messages that still notify (a muted room waits quietly), "Unread" and
 * "Mentions" count what their filter would list. Rooms the list cannot show
 * are left out.
 */
export function chatSidebarTabCounts(input: {
  roomIds: readonly string[];
  unreadByRoomId: Record<string, number>;
  mentionUnreadByRoomId: Record<string, number>;
  mutedRoomIds: ReadonlySet<string>;
}): Record<"all" | "unread" | "mentions", number> {
  const counts = { all: 0, unread: 0, mentions: 0 };
  for (const roomId of new Set(input.roomIds)) {
    if (!roomId) continue;
    if ((input.unreadByRoomId[roomId] ?? 0) > 0) {
      counts.unread += 1;
      if (!input.mutedRoomIds.has(roomId)) counts.all += 1;
    }
    if ((input.mentionUnreadByRoomId[roomId] ?? 0) > 0) counts.mentions += 1;
  }
  return counts;
}

/** Accent-insensitive: "tuan" finds "Tuấn", "thiet ke" finds "Thiết kế". */
function matchesText(text: string, filter: string): boolean {
  return foldedIncludes(text, filter);
}

/** Flat conversation list sorted like Zalo/Messages (pin → recent). */
function passesActivityFilter(
  sortRoomId: string,
  activityFilter: ChatSidebarActivityFilter,
  unreadByRoomId: Record<string, number>,
  mentionUnreadByRoomId: Record<string, number>,
): boolean {
  if (activityFilter === "all" || !sortRoomId) {
    return activityFilter === "all";
  }
  if (activityFilter === "unread") {
    return (unreadByRoomId[sortRoomId] ?? 0) > 0;
  }
  return (mentionUnreadByRoomId[sortRoomId] ?? 0) > 0;
}

export function buildUnifiedSidebarEntries(input: {
  /** Absent: every kind, as before scopes. */
  scope?: ChatScope;
  kindFilter: ChatSidebarKindFilter;
  activityFilter?: ChatSidebarActivityFilter;
  filterText: string;
  workspaceTitle: string;
  workspaceRoomId: string | null;
  channels: ChatRoomRecord[];
  groups: GroupChat[];
  contacts: ChatContact[];
  nicknamesByUserId: Record<string, string>;
  roomPreviewsByRoomId: Record<string, ChatRoomPreview>;
  pinnedByRoomId: Record<string, ChatRoomPreference>;
  unreadByRoomId?: Record<string, number>;
  mentionUnreadByRoomId?: Record<string, number>;
}): UnifiedSidebarEntry[] {
  const {
    scope,
    kindFilter,
    activityFilter = "all",
    filterText,
    workspaceTitle,
    workspaceRoomId,
    channels,
    groups,
    contacts,
    nicknamesByUserId,
    roomPreviewsByRoomId,
    pinnedByRoomId,
    unreadByRoomId = {},
    mentionUnreadByRoomId = {},
  } = input;

  const entries: UnifiedSidebarEntry[] = [];

  const include = (kind: Exclude<ChatSidebarKindFilter, "all">) =>
    (kindFilter === "all" || kindFilter === kind) && (!scope || kindInScope(scope, kind));

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

  const filtered =
    activityFilter === "all"
      ? entries
      : entries.filter((e) =>
          passesActivityFilter(e.sortRoomId, activityFilter, unreadByRoomId, mentionUnreadByRoomId),
        );

  return filtered.sort((a, b) => {
    // A workspace's own room heads its channels (canvas "Workspace").
    if (scope === "workspace" && (a.kind === "workspace") !== (b.kind === "workspace")) {
      return a.kind === "workspace" ? -1 : 1;
    }
    const pinOrder = comparePinnedRoomOrder(a.sortRoomId, b.sortRoomId, pinnedByRoomId);
    if (pinOrder !== 0) return pinOrder;
    return compareRoomPreviewRecency(
      a.sortRoomId ? roomPreviewsByRoomId[a.sortRoomId] : null,
      b.sortRoomId ? roomPreviewsByRoomId[b.sortRoomId] : null,
    );
  });
}
