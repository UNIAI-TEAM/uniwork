"use client";

import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { formatTypingLabel } from "./typing-indicator";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function resolveSidebarTypingNames(
  typingUserIds: readonly string[],
  options: {
    nicknamesByUserId?: Readonly<Record<string, string>>;
    contacts: readonly ChatContact[];
    fallbackNameByUserId?: Readonly<Record<string, string>>;
  },
): string[] {
  return typingUserIds.map((userId) => {
    const normalized = normalizeTypingUserId(userId);
    const nickname = resolveChatNicknameForUser(options.nicknamesByUserId, userId);
    if (nickname) return nickname;
    const contact = options.contacts.find(
      (entry) => normalizeTypingUserId(entry.user_id) === normalized,
    );
    if (contact?.display_name?.trim()) return contact.display_name.trim();
    const fallback = options.fallbackNameByUserId?.[normalized];
    if (fallback?.trim()) return fallback.trim();
    return userId;
  });
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
  return formatTypingLabel(names, options.t, options.locale);
}
