// The conversation list as rows, assembled the way the web's chat page builds
// its sidebar (packages/views/chat/chat-page-view.tsx → chat-sidebar.tsx →
// chat-sidebar-rows.tsx): the core room helpers split and count the rooms,
// lib/rooms-display.ts orders and words them. Counts come straight from the
// room records, so web and phone show the same numbers. The Chat tab builds the
// rows without typing or presence (audit P2 Perf): those change by the second,
// so it lays the typing lines over them (roomListTypingLines) and each row reads
// its peer's presence itself; sameRoomListRow lets an unchanged row skip a redraw.
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isMessageSeenByPeer } from "@uniwork/core/chat/read-receipt-utils";
import {
  chatRoomToContact,
  isDefaultWorkspaceChannel,
  mentionUnreadMapFromRooms,
  roomPreviewMapFromRooms,
  sidebarFromChatRooms,
  unreadMapFromRooms,
} from "@uniwork/core/chat/chat-room-helpers";
import { buildChatNameContext } from "./people-display";
import { applyKnownPeopleToRoomPreviews, buildUnifiedSidebarEntries, formatChatSidebarPreviewText, formatChatSidebarTime, isMissedCallPreview, sidebarEntryRoomId, splitChatSidebarPreviewPrefix, type ChatRoomPreference, type UnifiedSidebarEntry } from "./rooms-display";
import { displayLabelForChatContact, type ChatContact } from "@uniwork/core/chat/contact-labels";
import { formatSidebarTypingPreview, typingNameByUserIdFromContext } from "./typing-display";
import { sameUser } from "./user-id";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** What a row's avatar shows: a person (with presence) or the kind of room. */
export type RoomMark =
  | { kind: "dm"; label: string; online: boolean; userId?: string }
  | { kind: "group"; label?: string }
  | { kind: "workspace" | "channel" | "private-channel" };

/** The workspace room's name, unless it only repeats the workspace's (packages/views/chat/chat-page-utils.ts). */
export function workspaceRoomTitle(roomName: string | null | undefined, workspaceName: string | null | undefined, defaultLabel: string): string {
  const name = roomName?.trim();
  if (!name || name === workspaceName?.trim()) return defaultLabel;
  return name;
}

/** A room's name in a conversation's header, worded as its list row is. */
export function roomTitle(
  room: ChatRoomRecord,
  options: { nicknamesByUserId: Record<string, string>; workspaceName: string; t: TranslateFn },
): string {
  if (isDefaultWorkspaceChannel(room)) return workspaceRoomTitle(room.name, options.workspaceName, options.t("chat.workspace_room"));
  switch (room.kind) {
    case "channel":
      return room.visibility === "private" ? room.name : `#${room.name}`;
    case "dm":
      return displayLabelForChatContact(chatRoomToContact(room), options.nicknamesByUserId);
    default:
      return room.name;
  }
}

export interface RoomListRow {
  key: string;
  entry: UnifiedSidebarEntry;
  /** The room this row opens; null for a DM that does not exist yet. */
  roomId: string | null;
  room: ChatRoomRecord | null;
  title: string;
  mark: RoomMark;
  /** The sender a group line names, bold before the body ("Quân: "). */
  prefix: string | null;
  subtitle: string | null;
  typing: boolean;
  /** A call that rang for the reader and nobody answered: the line is red. */
  missed: boolean;
  /** A DM whose last message is the reader's and the peer has read (✓✓ by the time). */
  seen: boolean;
  time: string | null;
  unread: number;
  mentionUnread: number;
  muted: boolean;
  pinned: boolean;
}

/** The chips above the list (MobileList board): one at a time, applied to rows already built. */
export const ROOM_LIST_FILTERS = ["all", "unread", "mentions", "group", "channel"] as const;
export type RoomListFilter = (typeof ROOM_LIST_FILTERS)[number];

/** Rows a chip keeps; the workspace room is a channel (migration 165 made it a default one). */
export function filterRoomList(rows: readonly RoomListRow[], filter: RoomListFilter): RoomListRow[] {
  switch (filter) {
    case "unread":
      return rows.filter((row) => row.unread > 0 || row.mentionUnread > 0);
    case "mentions":
      return rows.filter((row) => row.mentionUnread > 0);
    case "group":
      return rows.filter((row) => row.mark.kind === "group");
    case "channel":
      return rows.filter((row) => row.mark.kind === "channel" || row.mark.kind === "private-channel" || row.mark.kind === "workspace");
    default:
      return [...rows];
  }
}

type WorkspaceMembers = ReadonlyArray<{ user_id: string; display_name: string; email: string }>;

interface TypingWords {
  t: TranslateFn;
  locale: string;
  nicknamesByUserId: Record<string, string>;
  contacts: readonly ChatContact[];
  fallbackNameByUserId: ReturnType<typeof typingNameByUserIdFromContext>;
}

function typingLine(typingIds: readonly string[], isGroup: boolean, words: TypingWords): string | null {
  return formatSidebarTypingPreview(typingIds, { isGroup, ...words });
}

const NO_TYPING: Readonly<Record<string, string>> = Object.freeze({});

/** "Chi đang nhập…" per room someone types in, worded as buildRoomList words it; one shared empty map while nobody types. */
export function roomListTypingLines(input: {
  rooms: ChatRoomRecord[];
  nicknamesByUserId: Record<string, string>;
  workspaceMembers: WorkspaceMembers;
  typingByRoomId: Record<string, string[]>;
  t: TranslateFn;
  locale: string;
}): Readonly<Record<string, string>> {
  // Nobody typing (most of the time): no names to work out, and the same object as last time.
  if (!input.rooms.some((room) => input.typingByRoomId[room.id]?.length)) return NO_TYPING;
  const lines: Record<string, string> = {};
  const { contacts } = sidebarFromChatRooms(input.rooms);
  const nameContext = buildChatNameContext(contacts, [], input.workspaceMembers, input.nicknamesByUserId);
  const words: TypingWords = {
    t: input.t,
    locale: input.locale,
    nicknamesByUserId: input.nicknamesByUserId,
    contacts,
    fallbackNameByUserId: typingNameByUserIdFromContext(nameContext),
  };
  for (const room of input.rooms) {
    const line = typingLine(input.typingByRoomId[room.id] ?? [], room.kind !== "dm", words);
    if (line) lines[room.id] = line;
  }
  return lines;
}

/** Two rows draw the same (the row's record and entry aside: a tap reads the newest row by key). */
export function sameRoomListRow(a: RoomListRow, b: RoomListRow): boolean {
  const markA = a.mark as { kind: string; label?: string; online?: boolean; userId?: string };
  const markB = b.mark as { kind: string; label?: string; online?: boolean; userId?: string };
  return (
    a.key === b.key &&
    a.roomId === b.roomId &&
    a.title === b.title &&
    a.prefix === b.prefix &&
    a.subtitle === b.subtitle &&
    a.typing === b.typing &&
    a.missed === b.missed &&
    a.seen === b.seen &&
    a.time === b.time &&
    a.unread === b.unread &&
    a.mentionUnread === b.mentionUnread &&
    a.muted === b.muted &&
    a.pinned === b.pinned &&
    markA.kind === markB.kind &&
    markA.label === markB.label &&
    markA.online === markB.online &&
    markA.userId === markB.userId
  );
}

/** The newest row with the key of one a skipped cell still holds; that very row once it has left the list. */
export function newestRow(rows: ReadonlyMap<string, RoomListRow>, held: RoomListRow): RoomListRow {
  return rows.get(held.key) ?? held;
}

export function buildRoomList(input: {
  rooms: ChatRoomRecord[];
  filterText: string;
  workspaceName: string;
  currentUserId: string;
  nicknamesByUserId: Record<string, string>;
  workspaceMembers: WorkspaceMembers;
  pinnedByRoomId: Record<string, ChatRoomPreference>;
  /** Left out by the Chat tab, which lays roomListTypingLines over the rows. */
  typingByRoomId?: Record<string, string[]>;
  /** Left out by the Chat tab, whose rows read presence themselves (every DM offline here). */
  isOnline?: (userId: string) => boolean;
  t: TranslateFn;
  locale: string;
}): RoomListRow[] {
  const { rooms, currentUserId, nicknamesByUserId, t, locale } = input;
  const typingByRoomId = input.typingByRoomId ?? {};
  const isOnline = input.isOnline ?? (() => false);
  const { workspaceRoom, contacts, groups, channels } = sidebarFromChatRooms(rooms);
  const unread = unreadMapFromRooms(rooms);
  const mentions = mentionUnreadMapFromRooms(rooms);
  const nameContext = buildChatNameContext(contacts, [], input.workspaceMembers, nicknamesByUserId);
  const previews = applyKnownPeopleToRoomPreviews(roomPreviewMapFromRooms(rooms), nameContext);
  const words: TypingWords = { t, locale, nicknamesByUserId, contacts, fallbackNameByUserId: typingNameByUserIdFromContext(nameContext) };
  const workspaceTitle = workspaceRoomTitle(workspaceRoom?.name, input.workspaceName, t("chat.workspace_room"));
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const mediaLabels = { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") };

  const entries = buildUnifiedSidebarEntries({
    kindFilter: "all",
    filterText: input.filterText,
    workspaceTitle,
    workspaceRoomId: workspaceRoom?.id ?? null,
    channels,
    groups,
    contacts,
    nicknamesByUserId,
    roomPreviewsByRoomId: previews,
    pinnedByRoomId: input.pinnedByRoomId,
    unreadByRoomId: unread,
    mentionUnreadByRoomId: mentions,
  });

  return entries.map((entry) => {
    const roomId = sidebarEntryRoomId(entry);
    // Every entry with a room id was built from `rooms`.
    const room = roomId ? (byId.get(roomId) as ChatRoomRecord) : null;
    const isGroup = entry.kind !== "dm";
    const preview = roomId ? previews[roomId] : undefined;
    const typing = typingLine(roomId ? (typingByRoomId[roomId] ?? []) : [], isGroup, words);
    const previewOptions = {
      currentUserId,
      youLabel: t("chat.you"),
      voiceCallLabel: t("chat.sidebar_voice_call_preview"),
      voiceMessageLabel: t("chat.sidebar_voice_message_preview"),
      missedCallLabel: t("chat.voice_call_log_missed"),
      fileMessageLabel: t("chat.sidebar_file_message_preview"),
      nicknamesByUserId,
      mediaLabels,
    };
    const previewText = formatChatSidebarPreviewText(preview, { ...previewOptions, isGroup });
    const { prefix, body } = isGroup
      ? splitChatSidebarPreviewPrefix(previewText, formatChatSidebarPreviewText(preview, { ...previewOptions, isGroup: false }))
      : { prefix: null, body: previewText };
    // A tick only on a DM whose last message is mine: the peer's read pointer says whether it was seen.
    const seen =
      entry.kind === "dm" &&
      preview != null &&
      sameUser(preview.senderId, currentUserId) &&
      isMessageSeenByPeer(Date.parse(preview.createdAt), room?.peer_last_read_at);
    let title: string;
    let mark: RoomMark;
    switch (entry.kind) {
      case "workspace":
        title = workspaceTitle;
        mark = { kind: "workspace" };
        break;
      case "channel":
        title = entry.channel.visibility === "private" ? entry.channel.name : `#${entry.channel.name}`;
        mark = { kind: entry.channel.visibility === "private" ? "private-channel" : "channel" };
        break;
      case "group":
        title = entry.group.name;
        mark = { kind: "group", label: title };
        break;
      case "dm":
        title = displayLabelForChatContact(entry.contact, nicknamesByUserId);
        mark = { kind: "dm", label: title, online: isOnline(entry.contact.user_id), userId: entry.contact.user_id };
        break;
    }
    return {
      key: entry.key,
      entry,
      roomId,
      room,
      title,
      mark,
      prefix: typing ? null : prefix,
      subtitle: typing ?? body ?? (entry.kind === "workspace" ? t("chat.workspace_room_subtitle") : null),
      typing: typing !== null,
      missed: typing === null && isMissedCallPreview(preview, currentUserId),
      seen,
      time: formatChatSidebarTime(preview?.createdAt, { yesterdayLabel: t("chat.sidebar_yesterday"), locale }),
      unread: roomId ? (unread[roomId] ?? 0) : 0,
      mentionUnread: roomId ? (mentions[roomId] ?? 0) : 0,
      muted: room?.notifications_muted === true,
      pinned: roomId ? input.pinnedByRoomId[roomId]?.pinned === true : false,
    };
  });
}
