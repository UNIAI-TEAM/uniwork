"use client";

import { CalendarClock, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { emailHubLocale, formatEmailFullDate } from "./email-hub-format";
import { EmailHubScheduledStatusBadge, isScheduledSendFailed } from "./email-hub-scheduled-status";

interface EmailHubScheduledListItemProps {
  row: EmailHubScheduledSendItem;
  onSelect: () => void;
}

/** A queued send. A failed one says so in the row: it used to drop out of the list without a word. */
export function EmailHubScheduledListItem({ row, onSelect }: EmailHubScheduledListItemProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const recipients = row.to.join(", ");
  const failed = isScheduledSendFailed(row.status);
  const Icon = failed ? TriangleAlert : CalendarClock;

  return (
    <li className="border-b border-border/70 transition-colors duration-(--duration-fast) hover:bg-muted/60 focus-within:bg-muted/60">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left lg:px-4"
        onClick={onSelect}
      >
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            failed ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{row.subject || t("email_hub.no_subject")}</span>
          <span className="block truncate text-caption text-muted-foreground">
            {t("email_hub.to_recipient", { name: recipients || "—" })}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-right text-caption tabular-nums text-muted-foreground">
            {formatEmailFullDate(row.send_at, locale)}
          </span>
          {/* Everything in this folder is waiting by default; only the exception gets a chip. */}
          {failed ? <EmailHubScheduledStatusBadge status={row.status} /> : null}
        </span>
      </button>
    </li>
  );
}
