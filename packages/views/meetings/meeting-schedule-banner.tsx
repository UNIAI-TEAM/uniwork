"use client";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  msUntilScheduledEnd,
  SCHEDULE_WARN_1_MIN_MS,
  useExtendMeeting,
} from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { formatRemaining } from "./meeting-datetime";

/** Height the stage keeps clear below the banner, so a tile never touches it. */
const BANNER_GAP_PX = 8;
const BANNER_ANIM_MS = 280;

/** In-room banner: last minute of the scheduled window, then overtime until the host ends. */
export function MeetingScheduleBanner({
  endsAt,
  canHost = false,
  meetingId,
  workspaceId,
  onHeightChange,
}: {
  endsAt?: string;
  canHost?: boolean;
  meetingId?: string;
  workspaceId?: string;
  /** Reserve the banner needs at the top of the stage; 0 while it is hidden. */
  onHeightChange?: (heightPx: number) => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [entered, setEntered] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const extend = useExtendMeeting(workspaceId ?? "");

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const ms = endsAt ? msUntilScheduledEnd(endsAt, now) : null;
  const overtime = ms != null && ms <= 0;
  const lastMinute = ms != null && ms > 0 && ms <= SCHEDULE_WARN_1_MIN_MS;
  const visible = overtime || lastMinute;

  // The banner is an overlay, so the stage cannot shrink on its own: report the
  // room it takes and let the caller animate the tiles out from under it.
  useEffect(() => {
    if (!onHeightChange) return;
    if (!visible) {
      onHeightChange(0);
      return;
    }
    const el = bannerRef.current;
    if (!el) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height + BANNER_GAP_PX);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [visible, onHeightChange]);

  // Slide in over the same duration the tiles take to make room.
  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  if (!visible || !endsAt) return null;
  const remaining = formatRemaining(endsAt, now);
  const showExtend = overtime && canHost && Boolean(meetingId && workspaceId);

  const extendWindow = () => {
    if (!meetingId) return;
    extend.mutate(meetingId, {
      onError: (err) => toastApiError(err, t("common.error")),
      onSuccess: () => toast.success(t("meetings.extendedFifteen")),
    });
  };

  return (
    <>
      <div
        ref={bannerRef}
        className={cn(
          "absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-body font-medium shadow-sm",
          "motion-safe:transition-[transform,opacity] motion-safe:ease-out motion-reduce:transition-none",
          entered ? "translate-y-0 opacity-100" : "motion-safe:-translate-y-1 motion-safe:opacity-0",
          overtime
            ? "border border-warning/40 bg-warning/95 text-background"
            : "pointer-events-none border border-destructive/40 bg-destructive/95 text-destructive-foreground",
        )}
        style={{ transitionDuration: `${BANNER_ANIM_MS}ms` }}
        data-testid="meeting-schedule-banner"
      >
        <Clock aria-hidden className="size-4 shrink-0" />
        <span>
          {overtime
            ? t("meetings.scheduleOvertimeBanner")
            : t("meetings.scheduleEndingBanner", { time: remaining ?? "00:00:00" })}
        </span>
        {showExtend ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-background/40 bg-background/10 text-background hover:bg-background/20"
            disabled={extend.isPending}
            onClick={extendWindow}
          >
            {t("meetings.extendFifteen")}
          </Button>
        ) : null}
      </div>
      <p role="status" className="sr-only">
        {overtime ? t("meetings.scheduleOvertimeAnnounce") : t("meetings.scheduleEndingAnnounce")}
      </p>
    </>
  );
}
