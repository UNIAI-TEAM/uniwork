"use client";

import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { CHAT_BUBBLE_OTHER, CHAT_ON_BUBBLE_FILL, chatBubbleShape } from "./chat-message-row";
import { senderNameClass } from "./sender-colors";

/**
 * The frame every structured message shares — note, post, reminder, poll,
 * call summary. One header pattern (kind tile, overline, sender, time,
 * status) so the kinds differ by their tint and glyph, not by their chrome.
 * It sits in the sender's column like a bubble: theirs on the left behind
 * the avatar gutter, mine on the right, both on the light card fill.
 */
export function ChatCard({
  icon,
  tone,
  label,
  senderLabel,
  senderId,
  isOwn = false,
  showSenderName = false,
  ts,
  compactTop = false,
  status,
  wide = false,
  avatar,
  senderClassName,
  children,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  /** What kind of card this is, printed as the overline. */
  label: string;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  showSenderName?: boolean;
  ts?: number;
  compactTop?: boolean;
  /** A state pill on the right of the header (closed, due…). */
  status?: ReactNode;
  wide?: boolean;
  /** Theirs only: the sender's avatar, in the gutter at the card's foot. */
  avatar?: ReactNode;
  /** The name's colour when it is not a person's (UNI is the brand). */
  senderClassName?: string;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const labelId = useId();
  return (
    <article
      aria-labelledby={labelId}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full gap-2 rounded-xl focus-visible:outline-offset-2",
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-0.5" : "mt-3",
      )}
    >
      <span id={labelId} className="sr-only">
        {ts
          ? t("chat.message_list.card_label", {
              kind: label,
              sender: senderLabel,
              time: formatMessageDateTime(ts, i18n.language),
            })
          : t("chat.message_list.card_label_no_time", { kind: label, sender: senderLabel })}
      </span>
      {isOwn ? null : avatar ? (
        <span className="w-8.5 shrink-0 self-end">{avatar}</span>
      ) : (
        <span className="w-8.5 shrink-0" aria-hidden />
      )}
      <div
        className={cn(
          "min-w-0 max-w-[85%] px-3.5 pt-3 pb-2.5",
          chatBubbleShape(isOwn, !compactTop),
          CHAT_BUBBLE_OTHER,
          wide ? "w-120" : "w-105",
        )}
      >
        <header className="flex items-center gap-2.5">
          <IconTile icon={icon} tone={tone} size="sm" className="[&_svg]:size-4" />
          <div className="min-w-0 flex-1" aria-hidden>
            {/* The kind, and whose it is when the column does not say: mine
                sit on the right, so only theirs carry the name. */}
            <p className="truncate text-micro font-semibold tracking-wider text-muted-foreground uppercase">
              {label}
              {showSenderName || isOwn ? null : <span className="normal-case"> · {senderLabel}</span>}
            </p>
            {showSenderName && !isOwn ? (
              <p
                className={cn(
                  "truncate text-label font-semibold",
                  senderClassName ?? (senderId ? senderNameClass(senderId, isOwn) : "text-foreground"),
                )}
              >
                {senderLabel}
              </p>
            ) : null}
          </div>
          {status}
          {ts ? (
            <time
              dateTime={new Date(ts).toISOString()}
              title={formatMessageDateTime(ts, i18n.language)}
              aria-hidden
              className="shrink-0 text-micro text-muted-foreground tabular-nums"
            >
              {formatMessageTime(ts, i18n.language)}
            </time>
          ) : null}
        </header>
        <div className="mt-2.5">{children}</div>
      </div>
    </article>
  );
}

/** A small state pill for a card header: closed, due, live, pinned. */
export function ChatCardStatus({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "success" | "warning" | "info" | "brand";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-micro font-semibold [&_svg]:size-3",
        tone === "muted" && cn(CHAT_ON_BUBBLE_FILL, "text-muted-foreground"),
        tone === "success" && "bg-success-soft text-success-soft-foreground",
        tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
        tone === "info" && "bg-info-soft text-info-soft-foreground",
        tone === "brand" && "bg-brand-subtle text-brand",
      )}
    >
      {children}
    </span>
  );
}

/** "Đã ghim" in a note's or post's header while it is pinned to the top of the room (canvas). */
export function ChatCardPinnedStatus() {
  const { t } = useTranslation();
  return (
    <ChatCardStatus tone="brand">
      <Pin aria-hidden className="rotate-45" />
      {t("chat.card_pinned")}
    </ChatCardStatus>
  );
}
