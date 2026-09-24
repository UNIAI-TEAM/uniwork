"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isSameCalendarDay,
  isTomorrow,
  type ReminderRepeat,
} from "@uniwork/core/chat/reminder-utils";
import type { ChatMessage } from "./chat-messages";
import { ChatCard, ChatCardStatus } from "./chat-card";
import { formatMessageTime } from "./chat-message-time";

/** setTimeout cannot wait longer than about 24.8 days. */
const MAX_TIMER_MS = 2_147_000_000;

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
  const remindAtMs = Date.parse(reminder.remindAt);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // The card turns "due" at its time while it is on screen, not only when
  // the timeline happens to re-render.
  useEffect(() => {
    if (!Number.isFinite(remindAtMs) || nowMs >= remindAtMs) return;
    const wait = remindAtMs - Date.now();
    if (wait <= 0) {
      setNowMs(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.min(wait + 50, MAX_TIMER_MS));
    return () => window.clearTimeout(timer);
  }, [remindAtMs, nowMs]);

  const scheduleLabel = useMemo(() => {
    if (!Number.isFinite(remindAtMs)) return "";
    const date = new Date(remindAtMs);
    const now = new Date(nowMs);
    const time = formatMessageTime(remindAtMs, i18n.language);
    if (isSameCalendarDay(now, date)) {
      return t("chat.reminder_schedule_today", { time });
    }
    if (isTomorrow(now, date)) {
      return t("chat.reminder_schedule_tomorrow", { time });
    }
    return t("chat.reminder_schedule_date", {
      date: date.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    });
  }, [remindAtMs, nowMs, t, i18n.language]);

  const isDue = Number.isFinite(remindAtMs) && remindAtMs <= nowMs;

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
