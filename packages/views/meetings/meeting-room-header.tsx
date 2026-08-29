"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEndMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  formatMeetingRange,
  formatRemaining,
  meetingLocale,
} from "./meeting-datetime";

/** The countdown turns red only when the end is this close. */
const URGENT_MS = 5 * 60_000;

export function MeetingRoomHeader({
  meeting,
  workspaceId,
  onLeave,
  onOpenSidebar,
  recording = false,
}: {
  meeting?: Meeting;
  workspaceId?: string;
  onLeave: () => void;
  onOpenSidebar?: () => void;
  recording?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const start = useStartMeeting(workspaceId ?? "");
  const end = useEndMeeting(workspaceId ?? "");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!meeting?.ends_at) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [meeting?.ends_at]);

  const remaining = meeting?.ends_at
    ? formatRemaining(meeting.ends_at, now)
    : null;
  const urgent =
    Boolean(meeting?.ends_at) &&
    Date.parse(meeting!.ends_at) - now <= URGENT_MS;
  const subtitle = meeting
    ? meeting.description.trim() ||
      formatMeetingRange(
        meeting.starts_at,
        meeting.ends_at,
        meetingLocale(i18n.language),
      )
    : "";
  const scheduled = meeting?.status === "SCHEDULED" || !meeting?.status;
  const inProgress = meeting?.status === "IN_PROGRESS";
  const showHostActions = Boolean(workspaceId && canHost.allowed);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-app-shell px-3 sm:px-4">
      <Button
        type="button"
        variant="ghost"
        aria-label={t("meetings.leave")}
        onClick={onLeave}
        className="shrink-0 gap-1.5 px-2 text-muted-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        <span className="hidden sm:inline">{t("meetings.leave")}</span>
      </Button>
      <span
        aria-hidden
        className="hidden h-8 w-px shrink-0 bg-border sm:block"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title-sm font-semibold text-foreground">
          {meeting?.title ?? t("meetings.title")}
        </h1>
        {subtitle ? (
          <p className="truncate text-caption text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {recording ? (
          <p
            className="flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-caption font-medium text-destructive-foreground"
            data-testid="meeting-rec-badge"
          >
            <span
              aria-hidden
              className="size-2 animate-pulse rounded-full motion-reduce:animate-none bg-destructive-foreground"
            />
            {t("meetings.recording")}
          </p>
        ) : null}
        {remaining ? (
          <p
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption tabular-nums",
              urgent
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground",
            )}
          >
            <Clock aria-hidden className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {t("meetings.endsIn", { time: remaining })}
            </span>
            <span className="sm:hidden">{remaining}</span>
          </p>
        ) : null}
        {showHostActions && scheduled && meeting ? (
          <Button
            type="button"
            size="sm"
            disabled={start.isPending}
            onClick={() => start.mutate(meeting.id)}
          >
            {t("meetings.start")}
          </Button>
        ) : null}
        {showHostActions && inProgress && meeting ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={end.isPending}
            onClick={() => end.mutate(meeting.id)}
          >
            {t("meetings.end")}
          </Button>
        ) : null}
        {onOpenSidebar ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-label={t("meetings.openSidebar")}
            onClick={onOpenSidebar}
          >
            <Users aria-hidden />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
