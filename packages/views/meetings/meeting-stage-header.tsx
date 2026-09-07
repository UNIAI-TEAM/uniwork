"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  PanelRightClose,
  PanelRightOpen,
  UserPlus,
  Users,
} from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import { useTranslation } from "react-i18next";
import { isPastScheduledEnd, useEndMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { CreateInviteLinkDialog } from "./create-invite-link-dialog";
import { MeetingAdmitGuestsButton } from "./meeting-admit-guests-button";
import {
  formatMeetingRange,
  formatRemaining,
  meetingLocale,
} from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";

const URGENT_MS = 5 * 60_000;
const HEADER_AVATARS = 4;

export function MeetingStageHeader({
  meeting,
  meetingTitle,
  workspaceId,
  meetingsHref,
  workspaceLabel,
  guestMode,
  recording = false,
  sidebarOpen,
  onToggleSidebar,
  onOpenSidebar,
  onOpenJoinOverlay,
}: {
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  meetingsHref?: string;
  workspaceLabel?: string;
  guestMode?: boolean;
  recording?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onOpenSidebar?: () => void;
  onOpenJoinOverlay?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const participants = useParticipants();
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const start = useStartMeeting(workspaceId ?? "");
  const end = useEndMeeting(workspaceId ?? "");
  const [now, setNow] = useState(() => Date.now());
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (!meeting?.ends_at) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [meeting?.ends_at]);

  const remaining = meeting?.ends_at ? formatRemaining(meeting.ends_at, now) : null;
  const pastScheduledEnd = Boolean(meeting?.ends_at && isPastScheduledEnd(meeting.ends_at, now));
  const urgent =
    Boolean(meeting?.ends_at) &&
    !pastScheduledEnd &&
    Date.parse(meeting!.ends_at) - now <= URGENT_MS;
  const title = meeting?.title ?? meetingTitle ?? t("meetings.title");
  const scheduleRange = meeting
    ? formatMeetingRange(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language))
    : "";
  const description = meeting?.description.trim() ?? "";
  const scheduled = meeting?.status === "SCHEDULED" || !meeting?.status;
  const inProgress = meeting?.status === "IN_PROGRESS";
  const showHostActions = Boolean(workspaceId && canHost.allowed && !guestMode);
  const showInvite = Boolean(meeting?.id && showHostActions);
  const avatarPeople = participants.slice(0, HEADER_AVATARS);
  const overflowCount = Math.max(0, participants.length - HEADER_AVATARS);

  return (
    <>
      <div
        className="relative z-20 shrink-0 border-b border-meeting-bar-border/30 bg-rail px-3 py-2 sm:px-4 sm:py-2.5"
        data-testid="meeting-stage-header"
      >
        <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-3">
          <div className="min-w-0">
            {meetingsHref && !guestMode ? (
              <nav
                aria-label={t("meetings.title")}
                className="mb-0.5 truncate text-caption text-meeting-bar-foreground/70"
              >
                {workspaceLabel ? (
                  <>
                    <span>{workspaceLabel}</span>
                    <span aria-hidden className="mx-1.5 opacity-60">
                      /
                    </span>
                  </>
                ) : null}
                <AppLink
                  href={meetingsHref}
                  className="hover:text-meeting-bar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("meetings.title")}
                </AppLink>
              </nav>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
              <h1 className="min-w-0 max-w-full truncate text-title-sm font-semibold text-meeting-bar-foreground">
                {title}
              </h1>
              {scheduleRange && meeting ? (
                <>
                  <span aria-hidden className="shrink-0 text-meeting-bar-foreground/35">
                    ·
                  </span>
                  <time
                    dateTime={`${meeting.starts_at}/${meeting.ends_at}`}
                    className="min-w-0 truncate text-caption text-meeting-bar-foreground/75 tabular-nums"
                  >
                    {scheduleRange}
                  </time>
                </>
              ) : null}
            </div>
            {description ? (
              <p className="mt-0.5 truncate text-caption text-meeting-bar-foreground/70">{description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
            {recording ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-1 text-caption font-medium text-destructive-foreground"
                data-testid="meeting-rec-badge"
              >
                <span
                  aria-hidden
                  className="size-1.5 animate-pulse rounded-full motion-reduce:animate-none bg-destructive-foreground"
                />
                {t("meetings.recording")}
              </span>
            ) : null}

            {remaining ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold tabular-nums shadow-sm",
                  pastScheduledEnd || urgent
                    ? "bg-destructive text-destructive-foreground"
                    : "border border-meeting-bar-border bg-background text-foreground",
                )}
                data-testid="meeting-remaining-time"
              >
                <Clock aria-hidden className="size-3.5 shrink-0 opacity-90" />
                {pastScheduledEnd ? t("meetings.pastScheduledEndShort") : remaining}
              </span>
            ) : null}

            {showInvite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-meeting-bar-border bg-meeting-bar-chip-bg px-2 text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover sm:px-2.5"
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus aria-hidden className="size-4" />
                <span className="sr-only sm:not-sr-only sm:max-w-[8rem] sm:truncate">{t("meetings.shareGuestLink")}</span>
              </Button>
            ) : null}

            {showHostActions && inProgress && meeting ? (
              <Button
                type="button"
                size="sm"
                className="h-8 !border-destructive !bg-destructive px-2.5 font-semibold !text-destructive-foreground shadow-sm hover:!bg-destructive/90 hover:!text-destructive-foreground"
                disabled={end.isPending}
                onClick={() => end.mutate(meeting.id)}
              >
                {t("meetings.end")}
              </Button>
            ) : null}

            {showHostActions && scheduled && meeting ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden h-8 border-meeting-bar-border bg-meeting-bar-chip-bg px-2.5 text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover sm:inline-flex"
                disabled={start.isPending}
                onClick={() => start.mutate(meeting.id)}
              >
                {t("meetings.start")}
              </Button>
            ) : null}

            {avatarPeople.length > 0 ? (
              <div className="hidden items-center sm:flex" aria-hidden>
                <div className="flex -space-x-2">
                  {avatarPeople.map((p) => (
                    <MeetingPersonAvatar
                      key={p.identity}
                      name={p.name || p.identity}
                      size="sm"
                      className="ring-2 ring-rail"
                    />
                  ))}
                </div>
                {overflowCount > 0 ? (
                  <span className="ml-1.5 text-caption tabular-nums text-meeting-bar-foreground/80">
                    {t("meetings.moreParticipantsShort", { count: overflowCount })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {showHostActions && meeting?.id ? (
              <MeetingAdmitGuestsButton
                meetingId={meeting.id}
                onOpenOverlay={onOpenJoinOverlay}
                className="hidden sm:inline-flex"
              />
            ) : null}

            {onOpenSidebar ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 border-meeting-bar-border bg-meeting-bar-chip-bg text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover lg:hidden"
                aria-label={t("meetings.openSidebar")}
                onClick={onOpenSidebar}
              >
                <Users aria-hidden />
              </Button>
            ) : null}

            {onToggleSidebar ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="hidden size-9 border-meeting-bar-border bg-meeting-bar-chip-bg text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover lg:inline-flex"
                aria-label={sidebarOpen ? t("meetings.closeSidebar") : t("meetings.openSidebarPanel")}
                aria-pressed={sidebarOpen}
                onClick={onToggleSidebar}
              >
                {sidebarOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {meeting?.id ? (
        <CreateInviteLinkDialog meetingId={meeting.id} open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}
    </>
  );
}
