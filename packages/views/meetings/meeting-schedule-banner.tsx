"use client";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  msUntilScheduledEnd,
  SCHEDULE_WARN_1_MIN_MS,
  useEndMeeting,
  useExtendMeeting,
} from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { formatRemaining } from "./meeting-datetime";

/** Matches duration-standard on the slot, so the banner unmounts after it collapses. */
const BANNER_ANIM_MS = 200;

// Host actions sit on the solid destructive bar: outlined in the bar's own
// foreground, filled on hover.
const hostBtn =
  "h-8 border-on-solid bg-transparent text-on-solid hover:bg-on-solid hover:text-destructive-solid";

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
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const extend = useExtendMeeting(workspaceId ?? "");
  const end = useEndMeeting(workspaceId ?? "");

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
    setExpanded(true);
  }, [shouldShow, rendered]);

  if (!rendered || !endsAt) return null;

  const remaining = formatRemaining(endsAt, now);
  const showHostActions = overtime && canHost && Boolean(meetingId && workspaceId);

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
        // Opens in one step: animating the row track would reflow the video grid every frame.
        "grid shrink-0",
        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      data-testid="meeting-schedule-banner-slot"
      data-expanded={expanded ? "true" : undefined}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-body font-medium",
            // The last minute warns; running past the window is the harder state.
            overtime ? "bg-destructive-solid text-on-solid" : "pointer-events-none bg-warning-solid text-on-solid",
          )}
          data-testid="meeting-schedule-banner"
        >
          <Clock aria-hidden className="size-4 shrink-0" />
          <span>
            {overtime
              ? t("meetings.scheduleOvertimeBanner")
              : t("meetings.scheduleEndingBanner", { time: remaining ?? "00:00:00" })}
          </span>
          {showHostActions ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={hostBtn}
                disabled={extend.isPending}
                onClick={extendWindow}
              >
                {t("meetings.extendFifteen")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={hostBtn}
                disabled={end.isPending}
                onClick={() => setEndConfirmOpen(true)}
              >
                {t("meetings.end")}
              </Button>
            </>
          ) : null}
        </div>
        {shouldShow ? (
          <p role="status" className="sr-only">
            {overtime
              ? t("meetings.scheduleOvertimeAnnounce")
              : t("meetings.scheduleEndingAnnounce")}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={endConfirmOpen}
        onOpenChange={setEndConfirmOpen}
        title={t("meetings.endConfirmTitle")}
        description={t("meetings.endConfirm")}
        confirmLabel={t("meetings.confirmEnd")}
        pending={end.isPending}
        onConfirm={() => {
          if (!meetingId) return;
          end.mutate(meetingId, {
            onSuccess: () => setEndConfirmOpen(false),
            onError: (err) => toastApiError(err, t("common.error")),
          });
        }}
      />
    </div>
  );
}
