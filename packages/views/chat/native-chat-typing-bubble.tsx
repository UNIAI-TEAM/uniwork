"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import { CHAT_BUBBLE_OTHER, chatBubbleShape } from "./chat-message-row";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { formatTypingLabel } from "./typing-indicator";

const DOT_DELAYS = ["[animation-delay:0ms]", "[animation-delay:150ms]", "[animation-delay:300ms]"];

/**
 * Someone is typing: their avatar and a bubble of three pulsing dots at the
 * foot of the timeline (canvas). The typing ids arrive upper-cased; the name
 * context gives back the id as stored, which the avatar's colour hashes.
 */
export function ChatTypingBubble({ userIds, nameContext }: { userIds: string[]; nameContext: NameContextEntry[] }) {
  const { t, i18n } = useTranslation();
  if (userIds.length === 0) return null;
  const people = userIds.map((id) => {
    const entry = nameContext.find((candidate) => candidate.user_id.trim().toUpperCase() === id);
    return { id: entry?.user_id ?? id, name: entry?.display_name?.trim() || id };
  });
  const first = people[0]!;
  return (
    <div className="mt-3 flex items-end gap-2">
      <ChatSenderAvatar
        userId={first.id}
        name={first.name}
        avatarUrl={resolveAvatarUrlFromNameContext(nameContext, first.id)}
        nameContext={nameContext}
      />
      <div className={cn("flex gap-1 px-3.5 py-3.25 text-muted-foreground", chatBubbleShape(false, true), CHAT_BUBBLE_OTHER)}>
        <span className="sr-only">{formatTypingLabel(people.map((person) => person.name), t, i18n.language)}</span>
        {DOT_DELAYS.map((delay) => (
          <span
            key={delay}
            aria-hidden
            className={cn("size-1.75 rounded-full bg-current opacity-60 motion-safe:animate-pulse", delay)}
          />
        ))}
      </div>
    </div>
  );
}
