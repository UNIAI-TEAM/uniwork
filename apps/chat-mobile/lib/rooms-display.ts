// The conversation list's display rules, copied from the web (ADR 0011: views
// and the stateful core chat modules are not importable on mobile) and kept in
// parity by rooms-display.test.ts, which runs the web tests' cases:
//   buildUnifiedSidebarEntries      ← packages/views/chat/chat-sidebar-unified.ts
//   formatChatSidebarPreviewText, formatChatSidebarTime, compareRoomPreviewRecency,
//   applyKnownPeopleToRoomPreviews  ← packages/views/chat/chat-sidebar-preview.ts
//   comparePinnedRoomOrder          ← packages/core/chat/room-preferences-store.ts
//   sidebarEntryRoomId              ← packages/views/chat/chat-sidebar-unified-row.tsx
//   canSendInRoom                   ← packages/views/chat/{use-resolved-room-permissions,chat-room-moderation-utils}.ts
// The room → list mapping itself (sidebarFromChatRooms, unreadMapFromRooms,
// mentionUnreadMapFromRooms, roomPreviewMapFromRooms), the contact labels and
// the search folding are imported from core. scripts/mobile-web-copies.test.mjs
// fails when a web source above changes without this copy being reviewed.
import type { ChatRoomMemberRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isPlaceholderChatDisplayName, type ChatRoomPreview } from "@uniwork/core/chat/chat-room-helpers";
import { isRoomSendBlocked, mergeRoomMemberPermissions } from "@uniwork/core/chat/room-permissions-utils";
import { describeChatMediaBody, type ChatMediaLabels } from "./media-body";
import { deserializeMessageBodyToComposerDraft } from "./mentions";
import { givenNameOf } from "@uniwork/core/chat/initials";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { displayLabelForChatContact, normalizeChatUserId, resolveChatNicknameForUser, type ChatContact } from "@uniwork/core/chat/contact-labels";
import { dateTimeFormat } from "./locale-format";

export type { ChatRoomPreview };

export interface GroupChat {
  id: string;
  name: string;
  room_id: string;
  member_user_ids: string[];
}

/** Pins stay on the device, as the web keeps them in the browser. */
export type ChatRoomPreference = { pinned: boolean; pinnedAt: number };

function readPreference(byRoomId: Record<string, ChatRoomPreference>, roomId: string): ChatRoomPreference {
  return byRoomId[roomId] ?? { pinned: false, pinnedAt: 0 };
}

export function comparePinnedRoomOrder(
  leftRoomId: string,
  rightRoomId: string,
  byRoomId: Record<string, ChatRoomPreference>,
): number {
  const left = readPreference(byRoomId, leftRoomId);
  const right = readPreference(byRoomId, rightRoomId);
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  if (left.pinned && right.pinned && left.pinnedAt !== right.pinnedAt) return right.pinnedAt - left.pinnedAt;
  return 0;
}

export type ChatSidebarKindFilter = "all" | "workspace" | "channel" | "group" | "dm";
export type ChatSidebarActivityFilter = "all" | "unread" | "mentions";

export type UnifiedSidebarEntry =
  | { key: string; kind: "workspace"; roomId: string | null; sortRoomId: string }
  | { key: string; kind: "channel"; channel: ChatRoomRecord; sortRoomId: string }
  | { key: string; kind: "group"; group: GroupChat; sortRoomId: string }
  | { key: string; kind: "dm"; contact: ChatContact; sortRoomId: string };

function passesActivityFilter(
  sortRoomId: string,
  activityFilter: ChatSidebarActivityFilter,
  unreadByRoomId: Record<string, number>,
  mentionUnreadByRoomId: Record<string, number>,
): boolean {
  if (activityFilter === "all" || !sortRoomId) return activityFilter === "all";
  if (activityFilter === "unread") return (unreadByRoomId[sortRoomId] ?? 0) > 0;
  return (mentionUnreadByRoomId[sortRoomId] ?? 0) > 0;
}

/** Flat conversation list sorted like Zalo/Messages (pin → recent). */
export function buildUnifiedSidebarEntries(input: {
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
  const { kindFilter, activityFilter = "all", filterText, workspaceTitle, workspaceRoomId } = input;
  const { channels, groups, contacts, nicknamesByUserId, roomPreviewsByRoomId, pinnedByRoomId } = input;
  const { unreadByRoomId = {}, mentionUnreadByRoomId = {} } = input;
  const entries: UnifiedSidebarEntry[] = [];
  const include = (kind: ChatSidebarKindFilter) => kindFilter === "all" || kindFilter === kind;

  if (include("workspace") && foldedIncludes(workspaceTitle, filterText)) {
    entries.push({ key: "workspace", kind: "workspace", roomId: workspaceRoomId, sortRoomId: workspaceRoomId ?? "" });
  }
  if (include("channel")) {
    for (const channel of channels) {
      if (!foldedIncludes(channel.name, filterText) && !foldedIncludes(channel.topic ?? "", filterText)) continue;
      entries.push({ key: `channel:${channel.id}`, kind: "channel", channel, sortRoomId: channel.id });
    }
  }
  if (include("group")) {
    for (const group of groups) {
      if (!foldedIncludes(group.name, filterText)) continue;
      entries.push({ key: `group:${group.id}`, kind: "group", group, sortRoomId: group.room_id });
    }
  }
  if (include("dm")) {
    for (const contact of contacts) {
      const label = displayLabelForChatContact(contact, nicknamesByUserId);
      if (!foldedIncludes(label, filterText) && !foldedIncludes(contact.email, filterText)) continue;
      entries.push({ key: `dm:${contact.user_id}`, kind: "dm", contact, sortRoomId: contact.dm_room_id ?? "" });
    }
  }

  const filtered =
    activityFilter === "all"
      ? entries
      : entries.filter((e) => passesActivityFilter(e.sortRoomId, activityFilter, unreadByRoomId, mentionUnreadByRoomId));

  return filtered.sort((a, b) => {
    const pinOrder = comparePinnedRoomOrder(a.sortRoomId, b.sortRoomId, pinnedByRoomId);
    if (pinOrder !== 0) return pinOrder;
    return compareRoomPreviewRecency(
      a.sortRoomId ? roomPreviewsByRoomId[a.sortRoomId] : null,
      b.sortRoomId ? roomPreviewsByRoomId[b.sortRoomId] : null,
    );
  });
}

/** The room an entry opens; null for a DM whose room does not exist yet. */
export function sidebarEntryRoomId(entry: UnifiedSidebarEntry): string | null {
  switch (entry.kind) {
    case "workspace":
      return entry.roomId;
    case "channel":
      return entry.channel.id;
    case "group":
      return entry.group.room_id;
    case "dm":
      return entry.contact.dm_room_id ?? null;
  }
}

function sameUser(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** A call that rang for me and nobody answered: the list draws it red, as missed (chat-sidebar-preview.ts). */
export function isMissedCallPreview(preview: ChatRoomPreview | null | undefined, currentUserId: string): boolean {
  return preview?.kind === "voice_call_log" && preview.callOutcome === "unanswered" && !sameUser(preview.senderId, currentUserId);
}

const IMAGE_FILE_NAME = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;

export function formatChatSidebarPreviewText(
  preview: ChatRoomPreview | null | undefined,
  options: {
    currentUserId: string;
    isGroup: boolean;
    youLabel: string;
    voiceCallLabel: string;
    voiceMessageLabel?: string;
    missedCallLabel?: string;
    fileMessageLabel?: string;
    nicknamesByUserId?: Readonly<Record<string, string>>;
    mediaLabels?: ChatMediaLabels;
  },
): string | null {
  if (!preview) return null;
  if (preview.kind === "voice_call_log") {
    return isMissedCallPreview(preview, options.currentUserId) && options.missedCallLabel ? options.missedCallLabel : options.voiceCallLabel;
  }
  let body: string | null;
  if (preview.kind === "voice") {
    const label = options.voiceMessageLabel ?? options.voiceCallLabel;
    // "Tin nhắn thoại · 0:42", rounded up as the voice note itself shows it.
    const ms = preview.durationMs ?? 0;
    body = ms > 0 ? `${label} · ${formatVoiceCallDuration(Math.ceil(ms / 1000))}` : label;
  } else if (preview.kind === "file") {
    // A photo is sent as a file named after itself: the list says "Ảnh".
    const name = preview.body.trim();
    body = name && options.mediaLabels && IMAGE_FILE_NAME.test(name) ? options.mediaLabels.image : name || options.fileMessageLabel || null;
  } else {
    const media = options.mediaLabels ? describeChatMediaBody(preview.body, options.mediaLabels) : null;
    body = media ?? deserializeMessageBodyToComposerDraft(preview.body).trim();
  }
  if (!body) return null;
  if (options.isGroup) {
    const isSelf = sameUser(preview.senderId, options.currentUserId);
    const selfNickname = resolveChatNicknameForUser(options.nicknamesByUserId, options.currentUserId);
    const peerNickname = resolveChatNicknameForUser(options.nicknamesByUserId, preview.senderId);
    const peerName = preview.senderName.trim();
    const sender = isSelf
      ? selfNickname || options.youLabel
      : peerNickname || (peerName && !isPlaceholderChatDisplayName(peerName, preview.senderId) ? givenNameOf(peerName) : "");
    return sender ? `${sender}: ${body}` : body;
  }
  return body;
}

/**
 * The sender prefix a group row shows bold before the body ("Quân: "), split
 * off the text formatChatSidebarPreviewText built: the body alone comes from
 * the same formatter with `isGroup: false`, so the two never disagree.
 */
export function splitChatSidebarPreviewPrefix(groupText: string | null, bodyText: string | null): { prefix: string | null; body: string | null } {
  if (!groupText || !bodyText || groupText === bodyText || !groupText.endsWith(bodyText)) return { prefix: null, body: groupText };
  return { prefix: groupText.slice(0, groupText.length - bodyText.length), body: bodyText };
}

type SidebarTimeFormat = "time" | "weekday" | "date";

const SIDEBAR_TIME_OPTIONS: Record<SidebarTimeFormat, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  weekday: { weekday: "short" },
  date: { month: "numeric", day: "numeric", year: "numeric" },
};

// The app's language and the device's clock, one cached formatter per shape (lib/locale-format.ts).
function sidebarTimeFormatter(locale: string | undefined, format: SidebarTimeFormat): Intl.DateTimeFormat {
  return dateTimeFormat(locale, SIDEBAR_TIME_OPTIONS[format]);
}

export function formatChatSidebarTime(
  iso: string | undefined,
  options: { now?: Date; yesterdayLabel: string; locale?: string },
): string | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = options.now ?? new Date();
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const dayDiff = (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000);
  if (dayDiff === 0) return sidebarTimeFormatter(options.locale, "time").format(date);
  if (dayDiff === 1) return options.yesterdayLabel;
  if (dayDiff < 7) return sidebarTimeFormatter(options.locale, "weekday").format(date);
  return sidebarTimeFormatter(options.locale, "date").format(date);
}

/** A display name that is the person's id is not a name. */
function humanLabel(label: string, userId: string): string {
  const name = label.trim();
  if (!name || isPlaceholderChatDisplayName(name, userId)) return "";
  return name;
}

/**
 * The room list's last-message name is the account's display name, which can
 * be empty. Fill that gap from the names the chat already knows, and rewrite
 * a mention whose stored label is that id.
 */
export function applyKnownPeopleToRoomPreviews(
  previews: Record<string, ChatRoomPreview>,
  people: ReadonlyArray<{ user_id: string; display_name: string }>,
): Record<string, ChatRoomPreview> {
  const names = new Map<string, string>();
  for (const person of people) {
    const name = humanLabel(person.display_name, person.user_id);
    if (!person.user_id.trim() || !name) continue;
    names.set(person.user_id.trim().toUpperCase(), name);
  }
  if (names.size === 0) return previews;
  const out: Record<string, ChatRoomPreview> = {};
  for (const [roomId, preview] of Object.entries(previews)) {
    const known = names.get(preview.senderId.trim().toUpperCase());
    out[roomId] = { ...preview, senderName: known || preview.senderName, body: rewriteMentionIds(preview.body, names) };
  }
  return out;
}

function rewriteMentionIds(body: string, names: ReadonlyMap<string, string>): string {
  const withTokens = body.replace(/\[@([^\]]*)\]\(mention:\/\/member\/([^)]+)\)/g, (token, label: string, id: string) => {
    const known = names.get(id.trim().toUpperCase());
    if (!known || humanLabel(label, id)) return token;
    return `[@${known}](mention://member/${id})`;
  });
  return withTokens.replace(/(^|[^\w[])@([0-9A-HJKMNP-TV-Z]{26})\b/gi, (token, prefix: string, id: string) => {
    const known = names.get(id.toUpperCase());
    return known ? `${prefix}@${known}` : token;
  });
}

export function compareRoomPreviewRecency(left?: ChatRoomPreview | null, right?: ChatRoomPreview | null): number {
  const leftTs = left?.createdAt ? Date.parse(left.createdAt) : 0;
  const rightTs = right?.createdAt ? Date.parse(right.createdAt) : 0;
  return rightTs - leftTs;
}

/**
 * Whether the composer may send: the room's member permissions, the caller's
 * own send restriction, and who the server lets past the flags (a room admin,
 * or a group's creator).
 */
export function canSendInRoom(
  room: Pick<ChatRoomRecord, "kind" | "member_permissions"> | null | undefined,
  members: readonly ChatRoomMemberRecord[],
  currentUserId: string,
): boolean {
  const self = members.find((member) => normalizeChatUserId(member.user_id) === normalizeChatUserId(currentUserId));
  const bypasses = self?.role === "admin" || (room?.kind === "group" && self?.is_creator === true);
  return !isRoomSendBlocked(mergeRoomMemberPermissions(room?.member_permissions), bypasses, self?.send_restricted ?? false);
}
