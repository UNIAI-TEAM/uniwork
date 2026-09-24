"use client";

import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { ChatCard } from "./chat-card";

type PostPayload = NonNullable<ChatMessage["post"]>;

export function ChatPostMessageRow({
  post,
  senderLabel,
  senderId,
  isOwn,
  ts,
  showSenderName,
  compactTop,
}: {
  post: PostPayload;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  ts?: number;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ChatCard
      icon={Megaphone}
      tone="orange"
      label={t("chat.post_message_badge")}
      senderLabel={senderLabel}
      senderId={senderId}
      isOwn={isOwn}
      ts={ts}
      showSenderName={showSenderName}
      compactTop={compactTop}
      wide
    >
      <h3 className="text-title-sm font-semibold text-balance text-foreground">{post.title}</h3>
      {post.body.trim() ? (
        <p className="mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-foreground text-pretty [overflow-wrap:anywhere]">
          {post.body}
        </p>
      ) : null}
    </ChatCard>
  );
}
