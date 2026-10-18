"use client";

import { createContext, useContext } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
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

/**
 * What the unread line knows about the open room: how many messages were
 * unread when it opened, and the quick summary of them. Provided around the
 * room's timeline; without it the line is the plain "Tin mới".
 */
type ChatUnreadInfo = { count: number | null; onCatchUp?: () => void };
const ChatUnreadContext = createContext<ChatUnreadInfo>({ count: null });
export const ChatUnreadProvider = ChatUnreadContext.Provider;

/**
 * Where the messages that arrived since the reader last read begin: "N tin
 * chưa đọc" (or "Tin mới" when the count is unknown) and, when UNI can, a
 * quick summary of them.
 */
export function ChatUnreadSeparator() {
  const { t } = useTranslation();
  const { count, onCatchUp } = useContext(ChatUnreadContext);
  const label = count ? t("chat.unread_count_chip", { count }) : t("chat.new_messages");
  // The separator is the chip alone: a separator's children are
  // presentational, and the summary button beside it must stay a button.
  return (
    <div className="flex items-center gap-2.5 pt-4 pb-2">
      <span aria-hidden className="h-px flex-1 bg-faint-foreground/40" />
      <span role="separator" aria-label={label} className={`${WALL_CHIP_CLASS} tabular-nums`}>
        {label}
      </span>
      {onCatchUp ? (
        <Button
          type="button"
          variant="brand"
          size="sm"
          className="h-7.5 gap-1.5 rounded-full px-3 font-semibold"
          onClick={onCatchUp}
        >
          <Sparkles aria-hidden />
          {t("chat.catch_up_quick")}
        </Button>
      ) : null}
      <span aria-hidden className="h-px flex-1 bg-faint-foreground/40" />
    </div>
  );
}
