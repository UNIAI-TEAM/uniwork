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
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

type ReminderPayload = NonNullable<ChatMessage["reminder"]>;

function repeatLabelKey(repeat: ReminderRepeat): string {
  return `chat.reminder_repeat_${repeat}`;
}

export function ChatReminderMessageRow({
  reminder,
  senderLabel,
  showSenderName,
  compactTop,
}: {
  reminder: ReminderPayload;
  senderLabel: string;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();

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
    return t("chat.reminder_schedule_date", { date: date.toLocaleString() });
  }, [reminder.remindAt, t]);

  const isDue = Date.parse(reminder.remindAt) <= Date.now();

  return (
    <article className={cn("flex w-full max-w-full justify-center py-1", compactTop ? "pt-0.5" : "pt-3")}>
      <div
        className={cn(
          "w-full max-w-md rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm",
          isDue && "opacity-70",
        )}
      >
        {showSenderName ? (
          <p className="mb-1 text-caption font-medium text-brand">{senderLabel}</p>
        ) : null}

        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Clock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.reminder_message_badge")}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-body font-semibold text-foreground">{reminder.body}</p>
          </div>
        </div>

        <p className="text-caption text-muted-foreground">{scheduleLabel}</p>
        {reminder.repeat !== "none" ? (
          <p className="mt-1 text-caption text-brand">{t(repeatLabelKey(reminder.repeat))}</p>
        ) : null}
      </div>
    </article>
  );
}
