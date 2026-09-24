"use client";

import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { emailHubLocale, formatEmailFullDate } from "./email-hub-format";

interface EmailHubScheduledListItemProps {
  row: EmailHubScheduledSendItem;
  onSelect: () => void;
}

export function EmailHubScheduledListItem({ row, onSelect }: EmailHubScheduledListItemProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const recipients = row.to.join(", ");

  return (
    <li className="border-b border-border/70 transition-colors duration-(--duration-fast) hover:bg-muted/60 focus-within:bg-muted/60">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left lg:px-4"
        onClick={onSelect}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{row.subject || t("email_hub.no_subject")}</span>
          <span className="block truncate text-caption text-muted-foreground">
            {t("email_hub.to_recipient", { name: recipients || "—" })}
          </span>
        </span>
        <span className="shrink-0 text-right text-caption tabular-nums text-muted-foreground">
          {formatEmailFullDate(row.send_at, locale)}
        </span>
      </button>
    </li>
  );
}
