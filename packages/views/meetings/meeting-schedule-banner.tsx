"use client";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { msUntilScheduledEnd, SCHEDULE_WARN_1_MIN_MS } from "@uniwork/core/meetings";
import { formatRemaining } from "./meeting-datetime";

/** Persistent in-room banner during the final minute before scheduled end. */
export function MeetingScheduleBanner({ endsAt }: { endsAt?: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;
  const ms = msUntilScheduledEnd(endsAt, now);
  if (ms == null || ms <= 0 || ms > SCHEDULE_WARN_1_MIN_MS) return null;
  const remaining = formatRemaining(endsAt, now);

  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/95 px-3 py-2 text-center text-body font-medium text-destructive-foreground shadow-sm"
      data-testid="meeting-schedule-banner"
    >
      <Clock aria-hidden className="size-4 shrink-0" />
      <span>{t("meetings.scheduleEndingBanner", { time: remaining ?? "00:00:00" })}</span>
    </div>
  );
}
