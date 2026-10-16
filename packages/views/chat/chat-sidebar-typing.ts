"use client";

import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import {
  isPlaceholderChatDisplayName,
  resolveChatNicknameForUser,
} from "@uniwork/core/chat/contacts-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { formatTypingLabel } from "./typing-indicator";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function humanTypingName(label: string | undefined, userId: string): string {
  const name = label?.trim() ?? "";
  if (!name || isPlaceholderChatDisplayName(name, userId)) return "";
  return name;
}

/** Names the room list can use when a typist is a member but not a DM contact. */
export function typingNameByUserIdFromContext(
  people: ReadonlyArray<{ user_id: string; display_name: string }>,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const person of people) {
    const id = normalizeTypingUserId(person.user_id);
    const name = humanTypingName(person.display_name, person.user_id);
    if (!id || !name) continue;
    names[id] = name;
  }
  return names;
}

function resolveSidebarTypingNames(
  typingUserIds: readonly string[],
  options: {
    nicknamesByUserId?: Readonly<Record<string, string>>;
    contacts: readonly ChatContact[];
    fallbackNameByUserId?: Readonly<Record<string, string>>;
  },
): string[] {
  const names: string[] = [];
  for (const userId of typingUserIds) {
    const normalized = normalizeTypingUserId(userId);
    const nickname = humanTypingName(
      resolveChatNicknameForUser(options.nicknamesByUserId, userId),
      userId,
    );
    if (nickname) {
      names.push(nickname);
      continue;
    }
    const contact = options.contacts.find(
      (entry) => normalizeTypingUserId(entry.user_id) === normalized,
    );
    const contactName = humanTypingName(contact?.display_name, userId);
    if (contactName) {
      names.push(contactName);
      continue;
    }
    const fallback = humanTypingName(options.fallbackNameByUserId?.[normalized], userId);
    if (fallback) names.push(fallback);
  }
  return names;
}

export function formatSidebarTypingPreview(
  typingUserIds: readonly string[],
  options: {
    isGroup: boolean;
    t: TranslateFn;
    locale: string;
    nicknamesByUserId?: Readonly<Record<string, string>>;
    contacts: readonly ChatContact[];
    fallbackNameByUserId?: Readonly<Record<string, string>>;
  },
): string | null {
  if (typingUserIds.length === 0) return null;
  if (!options.isGroup) {
    return options.t("chat.sidebar_typing");
  }
  const names = resolveSidebarTypingNames(typingUserIds, options);
  // A raw id is not a name. The composer already resolved it; if this row
  // cannot, say someone is typing instead of printing the id.
  if (names.length === 0) return options.t("chat.sidebar_typing");
  return formatTypingLabel(names, options.t, options.locale);
}
