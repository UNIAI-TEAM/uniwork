"use client";

import { sessionStorageAdapter } from "../platform/storage";
import { isPlaceholderChatDisplayName, mergeChatContact } from "./chat-room-helpers";

export { isPlaceholderChatDisplayName, mergeChatContact };

export {
  displayLabelForChatContact,
  normalizeChatUserId,
  resolveChatNicknameForUser,
  type ChatContact,
} from "./contact-labels";
import type { ChatContact } from "./contact-labels";

const storageKey = (userId: string) => `uniwork:chat-contacts:${userId}`;

function readRaw(userId: string): ChatContact[] {
  const raw = sessionStorageAdapter.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatContact =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ChatContact).user_id === "string" &&
        typeof (item as ChatContact).email === "string" &&
        typeof (item as ChatContact).display_name === "string",
    );
  } catch {
    return [];
  }
}

function write(userId: string, contacts: ChatContact[]): void {
  sessionStorageAdapter.setItem(storageKey(userId), JSON.stringify(contacts));
}

export function listChatContacts(userId: string): ChatContact[] {
  return readRaw(userId);
}

export function upsertChatContact(userId: string, contact: ChatContact): ChatContact[] {
  const prev = readRaw(userId);
  const existing = prev.find((c) => c.user_id === contact.user_id);
  const merged = mergeChatContact(existing, contact);
  const next = [...prev.filter((c) => c.user_id !== contact.user_id), merged];
  write(userId, next);
  return next;
}

export function setChatContactRoom(userId: string, contactUserId: string, dmRoomId: string): ChatContact[] {
  const next = readRaw(userId).map((c) =>
    c.user_id === contactUserId ? { ...c, dm_room_id: dmRoomId } : c,
  );
  write(userId, next);
  return next;
}

export function removeChatContact(userId: string, contactUserId: string): ChatContact[] {
  const next = readRaw(userId).filter((c) => c.user_id !== contactUserId);
  write(userId, next);
  return next;
}

/** Test seam */
export function resetChatContactsForTests(userId?: string): void {
  if (userId) sessionStorageAdapter.removeItem(storageKey(userId));
}
