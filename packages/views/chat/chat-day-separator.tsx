"use client";

import { useTranslation } from "react-i18next";
import { formatMessageDay } from "./chat-message-time";

/** "Hôm nay", "Hôm qua", a weekday or a date — where one day of messages starts. */
export function ChatDaySeparator({ ts }: { ts: number }) {
  const { t, i18n } = useTranslation();
  const label = formatMessageDay(ts, i18n.language, {
    today: t("chat.day_today"),
    yesterday: t("chat.sidebar_yesterday"),
  });
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 pt-5 pb-2">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="text-caption font-medium text-muted-foreground first-letter:uppercase">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}
