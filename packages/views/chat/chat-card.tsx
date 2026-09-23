"use client";

import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { senderNameClass } from "./sender-colors";

/**
 * The frame every structured message shares — note, post, reminder, poll,
 * call summary. One header pattern (kind tile, overline, sender, time,
 * status) so the kinds differ by their tint and glyph, not by their chrome.
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
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const labelId = useId();
  return (
    <article
      aria-labelledby={labelId}
      tabIndex={-1}
      className={cn("flex w-full max-w-full justify-center rounded-xl focus-visible:outline-offset-2", compactTop ? "mt-2" : "mt-4")}
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
      <div
        className={cn(
          "w-full rounded-xl border border-border bg-surface p-3.5",
          wide ? "max-w-lg" : "max-w-md",
        )}
      >
        <header className="flex items-center gap-2.5">
          <IconTile icon={icon} tone={tone} size="sm" />
          <div className="min-w-0 flex-1" aria-hidden>
            {/* The kind and who made it, always: in a DM nothing else says
                whether this poll or note is mine or theirs. */}
            <p className="truncate text-overline text-muted-foreground uppercase">
              {label}
              {showSenderName ? null : <span className="normal-case"> · {senderLabel}</span>}
            </p>
            {showSenderName ? (
              <p
                className={cn(
                  "truncate text-caption font-semibold",
                  senderId ? senderNameClass(senderId, isOwn) : "text-foreground",
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

/** A small state pill for a card header: closed, due, live. */
export function ChatCardStatus({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "success" | "warning" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "success" && "bg-success-soft text-success-soft-foreground",
        tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
        tone === "info" && "bg-info-soft text-info-soft-foreground",
      )}
    >
      {children}
    </span>
  );
}
