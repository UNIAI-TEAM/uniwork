"use client";

import { useMemo } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatReminderTime,
  isSameCalendarDay,
  isTomorrow,
  type ReminderRepeat,
} from "@uniwork/core/chat/reminder-utils";
import type { ChatMessage } from "./chat-messages";
import { ChatCard, ChatCardStatus } from "./chat-card";

type ReminderPayload = NonNullable<ChatMessage["reminder"]>;

function repeatLabelKey(repeat: ReminderRepeat): string {
  return `chat.reminder_repeat_${repeat}`;
}

export function ChatReminderMessageRow({
  reminder,
  senderLabel,
  senderId,
  isOwn,
  ts,
  showSenderName,
  compactTop,
}: {
  reminder: ReminderPayload;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  ts?: number;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t, i18n } = useTranslation();

  const scheduleLabel = useMemo(() => {
    const remindAt = Date.parse(reminder.remindAt);
    if (!Number.isFinite(remindAt)) return "";
    const date = new Date(remindAt);
    const now = new Date();
    const time = formatReminderTime(date);
    if (isSameCalendarDay(now, date)) {
      return t("chat.reminder_schedule_today", { time });
    }
    if (isTomorrow(now, date)) {
      return t("chat.reminder_schedule_tomorrow", { time });
    }
    return t("chat.reminder_schedule_date", {
      date: date.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    });
  }, [reminder.remindAt, t, i18n.language]);

  const isDue = Date.parse(reminder.remindAt) <= Date.now();

  // A reminder that has fired keeps its full contrast — it is still the
  // record of what was asked — and says so with a pill instead of fading.
  return (
    <ChatCard
      icon={Clock}
      tone="teal"
      label={t("chat.reminder_message_badge")}
      senderLabel={senderLabel}
      senderId={senderId}
      isOwn={isOwn}
      ts={ts}
      showSenderName={showSenderName}
      compactTop={compactTop}
      status={isDue ? <ChatCardStatus>{t("chat.reminder_due_status")}</ChatCardStatus> : null}
    >
      <p className="whitespace-pre-wrap text-body font-medium text-foreground text-pretty [overflow-wrap:anywhere]">
        {reminder.body}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground tabular-nums">
        <Clock className="size-3.5" aria-hidden />
        {scheduleLabel}
        {reminder.repeat !== "none" ? <span>· {t(repeatLabelKey(reminder.repeat))}</span> : null}
      </p>
    </ChatCard>
  );
}
