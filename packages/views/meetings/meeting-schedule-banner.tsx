"use client";
import { useEffect, useState } from "react";
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

const BANNER_ANIM_MS = 280;

/** In-room banner: last minute of the scheduled window, then overtime until the host ends. */
export function MeetingScheduleBanner({
  endsAt,
  canHost = false,
  meetingId,
  workspaceId,
}: {
  endsAt?: string;
  canHost?: boolean;
  meetingId?: string;
  workspaceId?: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const extend = useExtendMeeting(workspaceId ?? "");

  const ms = endsAt ? msUntilScheduledEnd(endsAt, now) : null;
  const overtime = ms != null && ms <= 0;
  const lastMinute = ms != null && ms > 0 && ms <= SCHEDULE_WARN_1_MIN_MS;
  const shouldShow = Boolean(endsAt) && (overtime || lastMinute);
  const [rendered, setRendered] = useState(shouldShow);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  // Keep the slot mounted through the collapse so the tile grid can animate
  // its height instead of jumping when the banner unmounts.
  useEffect(() => {
    if (shouldShow) {
      setRendered(true);
      return;
    }
    setExpanded(false);
    if (!rendered) return;
    const id = window.setTimeout(() => setRendered(false), BANNER_ANIM_MS);
    return () => window.clearTimeout(id);
  }, [shouldShow, rendered]);

  useEffect(() => {
    if (!shouldShow || !rendered) {
      setExpanded(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [shouldShow, rendered]);

  if (!rendered || !endsAt) return null;

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
    <div
      className={cn(
        "grid shrink-0 motion-safe:transition-[grid-template-rows] motion-safe:ease-out motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      style={{ transitionDuration: `${BANNER_ANIM_MS}ms` }}
      data-testid="meeting-schedule-banner-slot"
      data-expanded={expanded ? "true" : undefined}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "mb-2 flex flex-wrap items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-body font-medium",
            overtime
              ? "border border-warning/40 bg-warning/95 text-background"
              : "pointer-events-none border border-destructive/40 bg-destructive/95 text-destructive-foreground",
          )}
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
      </div>
      {shouldShow ? (
        <p role="status" className="sr-only">
          {overtime ? t("meetings.scheduleOvertimeAnnounce") : t("meetings.scheduleEndingAnnounce")}
        </p>
      ) : null}
    </div>
  );
}
