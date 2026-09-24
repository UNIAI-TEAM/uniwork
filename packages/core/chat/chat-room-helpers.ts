import type { ChatRoomRecord, ChatUserLookup } from "../api/endpoints/chat";
import { mergeChatContact, type ChatContact } from "./contacts-store";
import type { GroupChat } from "./groups-store";
import { lookupChatUserByIdCached } from "./user-lookup";

export function chatRoomToContact(room: ChatRoomRecord): ChatContact {
  return {
    user_id: room.peer_user_id ?? room.member_user_ids[0] ?? "",
    email: room.peer_email ?? "",
    display_name: room.peer_display_name ?? room.name,
    dm_room_id: room.id,
  };
}

export function chatRoomToGroup(room: ChatRoomRecord): GroupChat {
  return {
    id: room.id,
    name: room.name,
    room_id: room.id,
    member_user_ids: room.member_user_ids,
  };
}

export function unreadMapFromRooms(rooms: ChatRoomRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const room of rooms) {
    if (room.unread_count > 0) out[room.id] = room.unread_count;
  }
  return out;
}

export function mentionUnreadMapFromRooms(rooms: ChatRoomRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const room of rooms) {
    if (room.mention_unread_count > 0) out[room.id] = room.mention_unread_count;
  }
  return out;
}

export type ChatRoomPreview = {
  body: string;
  kind: string;
  senderId: string;
  senderName: string;
  createdAt: string;
};

export function roomPreviewMapFromRooms(rooms: ChatRoomRecord[]): Record<string, ChatRoomPreview> {
  const out: Record<string, ChatRoomPreview> = {};
  for (const room of rooms) {
    const createdAt = room.last_message_at?.trim();
    if (!createdAt) continue;
    out[room.id] = {
      body: room.last_message_body ?? "",
      kind: room.last_message_kind ?? "text",
      senderId: room.last_message_sender_id ?? "",
      senderName: room.last_message_sender_name ?? "",
      createdAt,
    };
  }
  return out;
}

function isDefaultWorkspaceChannel(room: ChatRoomRecord): boolean {
  return room.kind === "workspace" || (room.kind === "channel" && Boolean(room.is_default));
}

export function sidebarFromChatRooms(rooms: ChatRoomRecord[]) {
  return {
    // Migration 165 turns workspace rooms into default channels; keep both shapes.
    workspaceRoom: rooms.find(isDefaultWorkspaceChannel) ?? null,
    contacts: dedupeDmContacts(rooms.filter((room) => room.kind === "dm").map(chatRoomToContact)),
    groups: rooms.filter((room) => room.kind === "group").map(chatRoomToGroup),
    // Non-default channels stay in their own sidebar section (grouped by project in the view).
    channels: rooms.filter((room) => room.kind === "channel" && !room.is_default),
  };
}

function normalizeChatUserId(userId: string): string {
  return userId.trim().toUpperCase();
}

/** One sidebar row per peer — merges API rows with different casing or missing email. */
export function dedupeDmContacts(contacts: ChatContact[]): ChatContact[] {
  const byUser = new Map<string, ChatContact>();
  for (const contact of contacts) {
    const key = normalizeChatUserId(contact.user_id);
    if (!key) continue;
    const existing = byUser.get(key);
    byUser.set(key, existing ? mergeChatContact(existing, contact) : contact);
  }
  return [...byUser.values()];
}

/** Keep the open DM in the sidebar before rooms refetch catches up. */
export function mergeActiveDmContact(
  contacts: ChatContact[],
  activeContact: ChatContact | null,
  resolvedRoomId: string | null,
): ChatContact[] {
  if (!activeContact?.user_id) return dedupeDmContacts(contacts);
  const roomId = activeContact.dm_room_id ?? resolvedRoomId ?? undefined;
  const merged: ChatContact = roomId ? { ...activeContact, dm_room_id: roomId } : activeContact;
  const peerKey = normalizeChatUserId(merged.user_id);
  const hasPeer = contacts.some((contact) => normalizeChatUserId(contact.user_id) === peerKey);
  const withActive = hasPeer
    ? contacts.map((contact) =>
        normalizeChatUserId(contact.user_id) === peerKey ? mergeChatContact(contact, merged) : contact,
      )
    : [...contacts, merged];
  return dedupeDmContacts(withActive);
}

export function toChatContactFromLookup(lookup: ChatUserLookup): ChatContact {
  return {
    user_id: lookup.user_id,
    email: lookup.email,
    display_name: lookup.display_name,
  };
}

export function fetchChatUserById(workspaceId: string, userId: string): Promise<ChatUserLookup | null> {
  return lookupChatUserByIdCached(workspaceId, userId);
}
