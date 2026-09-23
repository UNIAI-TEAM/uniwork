"use client";

import { Mail, MailOpen, Paperclip, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { EmailSenderAvatar, formatWhen } from "./email-hub-view-parts";

interface EmailHubThreadListItemProps {
  row: EmailHubThread;
  selected: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
  onToggleStar: () => void;
}

export function EmailHubThreadListItem({
  row,
  selected,
  onSelect,
  onPrefetch,
  onToggleStar,
}: EmailHubThreadListItemProps) {
  const { t } = useTranslation();
  const displayName =
    row.folder === "SENT" || row.folder === "DRAFTS"
      ? (row.to_addrs[0] ?? row.from_addr)
      : (row.from_name || row.from_addr);

  return (
    <li
      className={cn(
        "mx-2 flex rounded-xl border transition-all",
        selected ? "border-brand/25 bg-surface-selected shadow-sm" : "border-transparent hover:border-border hover:bg-muted/30",
      )}
    >
      <button
        type="button"
        className="inline-flex size-11 shrink-0 items-center justify-center self-start rounded-l-xl text-muted-foreground transition-colors hover:bg-brand-subtle/80 hover:text-brand"
        aria-label={row.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
        onClick={onToggleStar}
      >
        <Star
          className={cn("size-4", row.is_starred ? "fill-brand text-brand" : "text-muted-foreground/70")}
          aria-hidden
        />
      </button>
      <div
        role="button"
        tabIndex={0}
        className="flex min-w-0 flex-1 cursor-pointer gap-3 py-3 pr-3 text-left"
        onClick={onSelect}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <EmailSenderAvatar fromName={row.from_name} fromAddr={row.from_addr} className="size-9 text-caption" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-body", !row.is_read && "font-semibold")}>{displayName}</span>
            <span className="shrink-0 text-caption text-muted-foreground">{formatWhen(row.sent_at)}</span>
          </div>
          <p className={cn("truncate text-body", !row.is_read && "font-medium")}>
            {row.subject || t("email_hub.no_subject")}
          </p>
          {row.snippet ? <p className="truncate text-caption text-muted-foreground">{row.snippet}</p> : null}
          <div className="flex items-center gap-2">
            {!row.is_read ? (
              <span className="inline-flex items-center gap-1 text-caption font-medium text-brand">
                <Mail className="size-3" aria-hidden />
                {t("email_hub.filters.unread")}
              </span>
            ) : (
              <MailOpen className="size-3 text-muted-foreground/60" aria-hidden />
            )}
            {row.has_attachments ? (
              <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                <Paperclip className="size-3" aria-hidden />
                {t("email_hub.has_attachments")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
