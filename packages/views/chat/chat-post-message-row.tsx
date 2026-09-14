"use client";

import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

type PostPayload = NonNullable<ChatMessage["post"]>;

export function ChatPostMessageRow({
  post,
  senderLabel,
  showSenderName,
  compactTop,
}: {
  post: PostPayload;
  senderLabel: string;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <article
      className={cn(
        "flex w-full max-w-full justify-center",
        compactTop ? "mt-2.5" : "mt-4",
      )}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm">
        {showSenderName ? (
          <p className="mb-2 text-caption font-medium text-brand">{senderLabel}</p>
        ) : null}

        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Megaphone className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.post_message_badge")}
            </p>
            <h3 className="mt-1 text-body font-semibold leading-snug text-foreground">{post.title}</h3>
            {post.body.trim() ? (
              <p className="mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">
                {post.body}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
