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
    <article className={cn("flex w-full max-w-full justify-center py-1", compactTop ? "pt-0.5" : "pt-3")}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
        {showSenderName ? (
          <p className="mb-1 text-caption font-medium text-brand">{senderLabel}</p>
        ) : null}

        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Megaphone className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.post_message_badge")}
            </p>
            <h3 className="mt-1 text-title font-semibold text-foreground">{post.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-body text-foreground">{post.body}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
