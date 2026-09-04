"use client";

import { sessionStorageAdapter } from "../platform/storage";

export interface ChatContact {
  user_id: string;
  email: string;
  display_name: string;
  dm_room_id?: string | null;
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** True when the label is just the raw UniWork id (sync ran before profile loaded). */
export function isPlaceholderChatDisplayName(displayName: string, userId: string): boolean {
  const label = displayName.trim();
  if (!label) return true;
  if (label.toUpperCase() === userId.trim().toUpperCase()) return true;
  return ULID_PATTERN.test(label);
}

function preferDisplayName(
  incoming: string,
  existing: string | undefined,
  userId: string,
): string {
  if (!isPlaceholderChatDisplayName(incoming, userId)) return incoming;
  if (existing && !isPlaceholderChatDisplayName(existing, userId)) return existing;
  return incoming;
}

/** Keep human-readable names when a background sync only knows the UniWork id. */
export function mergeChatContact(existing: ChatContact | undefined, incoming: ChatContact): ChatContact {
  if (!existing) return incoming;
  return {
    user_id: incoming.user_id,
    email: incoming.email || existing.email,
    display_name: preferDisplayName(incoming.display_name, existing.display_name, incoming.user_id),
    dm_room_id: incoming.dm_room_id ?? existing.dm_room_id,
  };
}

/** Human-readable label for sidebar/header — never prefer a raw ULID when email exists. */
export function displayLabelForChatContact(
  contact: Pick<ChatContact, "user_id" | "display_name" | "email">,
): string {
  if (!isPlaceholderChatDisplayName(contact.display_name, contact.user_id)) {
    return contact.display_name;
  }
  if (contact.email.trim()) return contact.email;
  return contact.display_name;
}

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
