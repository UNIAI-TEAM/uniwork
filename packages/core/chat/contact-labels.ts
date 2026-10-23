// How the chat names a person: a personal nickname (whatever the ULID casing
// of the map's keys), else a real display name, else the email — never a raw
// ULID. Pure: the web (contacts-store.ts re-exports it) and the phone
// (apps/chat-mobile, ADR 0011) share it.
import { isPlaceholderChatDisplayName } from "./chat-room-helpers";

export interface ChatContact {
  user_id: string;
  email: string;
  display_name: string;
  dm_room_id?: string | null;
}

export function normalizeChatUserId(userId: string): string {
  return userId.trim().toUpperCase();
}

/** Resolves a personal nickname regardless of ULID casing in map keys. */
export function resolveChatNicknameForUser(
  nicknamesByUserId: Readonly<Record<string, string>> | undefined,
  userId: string,
): string | undefined {
  if (!nicknamesByUserId) return undefined;
  const direct = nicknamesByUserId[userId]?.trim();
  if (direct) return direct;
  const key = normalizeChatUserId(userId);
  for (const [id, nickname] of Object.entries(nicknamesByUserId)) {
    if (normalizeChatUserId(id) === key) {
      const trimmed = nickname.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/** Human-readable label for sidebar/header — never prefer a raw ULID when email exists. */
export function displayLabelForChatContact(
  contact: Pick<ChatContact, "user_id" | "display_name" | "email">,
  nicknamesByUserId?: Readonly<Record<string, string>>,
): string {
  const nickname = resolveChatNicknameForUser(nicknamesByUserId, contact.user_id);
  if (nickname) return nickname;
  if (!isPlaceholderChatDisplayName(contact.display_name, contact.user_id)) {
    return contact.display_name;
  }
  if (contact.email.trim()) return contact.email;
  return contact.display_name;
}
