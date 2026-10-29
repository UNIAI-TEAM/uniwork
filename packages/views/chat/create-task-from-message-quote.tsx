"use client";

import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initialsOf } from "@uniwork/core/chat/initials";
import { formatMessageTime } from "./chat-message-time";
import { chatPersonFaceClass } from "./chat-person-card";
import { senderNameClass, senderQuoteClass } from "./sender-colors";
import { memberDisplayLabel } from "./workspace-member-picker-utils";

/** One selected chat message quoted above the create-task form. */
export function SourceMessageQuote({
  workspaceId,
  senderId,
  sentAt,
  roomTitle,
  body,
}: {
  workspaceId: string;
  senderId: string;
  sentAt?: number;
  roomTitle?: string;
  body: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: members = [] } = useMembers(workspaceId);
  const member = members.find((entry) => entry.user_id === senderId);
  const name = member ? memberDisplayLabel(member) : t("chat.link.source_sender_unknown");
  return (
    <figure
      aria-label={t("chat.link.source_message")}
      className={cn(senderQuoteClass(senderId), "flex gap-2.5 rounded-lg border-l-3 bg-muted px-3 py-2.5")}
    >
      <ActorAvatar
        name={name}
        initials={initialsOf(name)}
        size="fluid"
        className={cn("size-7 text-micro", chatPersonFaceClass(senderId))}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-label font-semibold", senderNameClass(senderId, false))}>{name}</span>
          {sentAt || roomTitle ? (
            <span className="min-w-0 truncate text-caption text-muted-foreground tabular-nums">
              {[roomTitle, sentAt ? formatMessageTime(sentAt, i18n.language) : ""].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-3 text-body text-foreground">{body}</span>
      </span>
    </figure>
  );
}

export type CreateTaskSourceMessage = {
  id: string;
  body: string;
  senderId?: string;
  sentAt?: number;
};

/** Join selected messages into a starter description (oldest first). */
export function descriptionFromSourceMessages(messages: CreateTaskSourceMessage[]): string {
  return messages
    .map((message) => message.body.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Newest message becomes the linked origin; older ones only feed the description. */
export function anchorSourceMessage(messages: CreateTaskSourceMessage[]): CreateTaskSourceMessage | null {
  if (messages.length === 0) return null;
  return [...messages].sort((a, b) => {
    const ta = a.sentAt ?? 0;
    const tb = b.sentAt ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  })[messages.length - 1]!;
}
