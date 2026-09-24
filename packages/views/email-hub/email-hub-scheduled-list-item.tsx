"use client";

import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { formatWhen } from "./email-hub-view-parts";

interface EmailHubScheduledListItemProps {
  row: EmailHubScheduledSendItem;
  selected: boolean;
  onSelect: () => void;
}

export function EmailHubScheduledListItem({ row, selected, onSelect }: EmailHubScheduledListItemProps) {
  const { t } = useTranslation();
  const recipient = row.to[0] ?? "";

  return (
    <li
      className={cn(
        "mx-2 rounded-xl border transition-all",
        selected ? "border-brand/25 bg-surface-selected shadow-sm" : "border-transparent hover:border-border hover:bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full min-w-0 cursor-pointer gap-3 px-3 py-3 text-left"
        onClick={onSelect}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Clock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium">{recipient || "—"}</span>
            <span className="shrink-0 text-caption text-muted-foreground">{formatWhen(row.send_at)}</span>
          </div>
          <p className="truncate text-body">{row.subject || t("email_hub.no_subject")}</p>
          <p className="truncate text-caption text-muted-foreground">{t("email_hub.scheduled.list_hint")}</p>
        </div>
      </button>
    </li>
  );
}
