"use client";

import { ChevronDown, Megaphone } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { ChatCard, ChatCardPinnedStatus } from "./chat-card";

type PostPayload = NonNullable<ChatMessage["post"]>;

export function ChatPostMessageRow({
  post,
  senderLabel,
  senderId,
  isOwn,
  ts,
  showSenderName,
  compactTop,
  avatar,
}: {
  post: PostPayload;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  ts?: number;
  showSenderName?: boolean;
  compactTop?: boolean;
  /** Theirs only: the sender's avatar at the card's foot, as a run's last bubble has. */
  avatar?: ReactNode;
}) {
  const { t } = useTranslation();
  const bodyId = useId();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  // A long post opens on three lines; "Đọc tiếp" shows the rest (canvas).
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (node && !expanded) setOverflows(node.scrollHeight > node.clientHeight + 1);
  }, [expanded, post.body]);

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
      avatar={avatar}
      status={post.pinToTop ? <ChatCardPinnedStatus /> : undefined}
      wide
    >
      <h3 className="text-title-sm font-bold text-balance text-foreground">{post.title}</h3>
      {post.body.trim() ? (
        <p
          ref={bodyRef}
          id={bodyId}
          className={cn(
            "mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-foreground text-pretty [overflow-wrap:anywhere]",
            !expanded && "line-clamp-3",
          )}
        >
          {post.body}
        </p>
      ) : null}
      {overflows || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="mt-0.5 inline-flex h-8.5 items-center gap-1 rounded-md px-0.5 text-label font-semibold text-brand"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t("chat.post_read_less") : t("chat.post_read_more")}
          <ChevronDown aria-hidden className={cn("size-3.75", expanded && "rotate-180")} />
        </button>
      ) : null}
    </ChatCard>
  );
}
