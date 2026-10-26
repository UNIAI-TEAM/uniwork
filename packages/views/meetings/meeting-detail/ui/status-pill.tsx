"use client";
import { Ban, CalendarX, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export type MeetingPillStatus = "SCHEDULED" | "IN_PROGRESS" | "OVERTIME" | "MISSED" | "ENDED" | "CANCELED";

const TONE: Record<MeetingPillStatus, string> = {
  SCHEDULED: "bg-info-soft text-info-soft-foreground",
  IN_PROGRESS: "bg-success-soft text-success-soft-foreground",
  OVERTIME: "bg-warning-soft text-warning-soft-foreground",
  MISSED: "bg-muted text-muted-foreground",
  ENDED: "bg-muted text-muted-foreground",
  CANCELED: "bg-muted text-muted-foreground",
};

const dot = "size-1.5 shrink-0 rounded-full bg-current";

/**
 * The detail page's status pill (kit `.pill`): 22 tall, r6, caption 500.
 * Scheduled and live carry a dot (live pulses unless motion is reduced),
 * overtime a warning triangle, missed a crossed calendar, canceled a ban sign.
 * `minutes` is the formatted time after the label ("24 phút" → "Đang diễn ra
 * · 24 phút"). The list keeps `MeetingStatusBadge`; this one is detail-only
 * (PLAN D8: canceled is muted here).
 */
export function MeetingStatusPill({
  status,
  minutes,
  className,
}: {
  status: string;
  minutes?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const known = (status in TONE ? status : "ENDED") as MeetingPillStatus;
  const label = known === "SCHEDULED" ? t("meetings.detail.ui.pillScheduled") : t(`meetings.status_${known}`);
  return (
    <span
      data-status={known}
      className={cn(
        "inline-flex h-5.5 items-center gap-1.5 rounded-sm px-2 text-caption font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        TONE[known],
        className,
      )}
    >
      {known === "SCHEDULED" ? <span aria-hidden className={dot} /> : null}
      {known === "IN_PROGRESS" ? <span aria-hidden className={cn(dot, "animate-live-pulse motion-reduce:animate-none")} /> : null}
      {known === "OVERTIME" ? <TriangleAlert aria-hidden /> : null}
      {known === "MISSED" ? <CalendarX aria-hidden /> : null}
      {known === "CANCELED" ? <Ban aria-hidden /> : null}
      {minutes ? t("meetings.detail.ui.pillWithTime", { status: label, time: minutes }) : label}
    </span>
  );
}
