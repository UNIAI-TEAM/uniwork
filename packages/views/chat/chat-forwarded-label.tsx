"use client";

import { Forward } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

/** "Chuyển tiếp từ <tên>" over a forwarded copy: the original author, never the room it came from. */
export function ChatForwardedLabel({
  message,
  isOwn,
  className,
}: {
  message: ChatMessage;
  isOwn: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const from = message.forwardedFrom;
  if (!from) return null;
  const name = from.senderName.trim();
  return (
    <p
      className={cn(
        "mb-0.5 flex min-w-0 items-center gap-1 text-caption font-medium",
        isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground",
        className,
      )}
    >
      <Forward className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name ? t("chat.forward.from", { name }) : t("chat.forward.from_unknown")}</span>
    </p>
  );
}
