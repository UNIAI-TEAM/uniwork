"use client";

import { useTranslation } from "react-i18next";
import { formatMessageDay } from "./chat-message-time";

/** A centred chip on the chat wall: the day separator and the unread line share it. */
const WALL_CHIP_CLASS =
  "rounded-lg bg-chat-chip px-3 py-1 text-label font-semibold text-chat-chip-foreground first-letter:uppercase";

/** "Hôm nay", "Hôm qua", a weekday or a date — where one day of messages starts. */
export function ChatDaySeparator({ ts }: { ts: number }) {
  const { t, i18n } = useTranslation();
  const label = formatMessageDay(ts, i18n.language, {
    today: t("chat.day_today"),
    yesterday: t("chat.sidebar_yesterday"),
  });
  return (
    <div role="separator" aria-label={label} className="flex justify-center pt-5 pb-2">
      <span className={WALL_CHIP_CLASS}>{label}</span>
    </div>
  );
}

/** "Tin mới": where the messages that arrived since the reader last read begin. */
export function ChatUnreadSeparator() {
  const { t } = useTranslation();
  const label = t("chat.new_messages");
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-2.5 pt-4 pb-2">
      <span aria-hidden className="h-px flex-1 bg-faint-foreground/40" />
      <span className={WALL_CHIP_CLASS}>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-faint-foreground/40" />
    </div>
  );
}
