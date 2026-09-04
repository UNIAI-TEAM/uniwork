"use client";
import { useEffect, useState } from "react";
import { Clock, PanelRightClose, PanelRightOpen, UserPlus, Users } from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import { useTranslation } from "react-i18next";
import { isPastScheduledEnd, useEndMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { CreateInviteLinkDialog } from "./create-invite-link-dialog";
import {
  formatMeetingRange,
  formatRemaining,
  meetingLocale,
} from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";

const URGENT_MS = 5 * 60_000;
const HEADER_AVATARS = 4;

export function MeetingRoomHeader({
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
  const subtitle = meeting
    ? meeting.description.trim() ||
      formatMeetingRange(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language))
    : "";
  const scheduled = meeting?.status === "SCHEDULED" || !meeting?.status;
  const inProgress = meeting?.status === "IN_PROGRESS";
  const showHostActions = Boolean(workspaceId && canHost.allowed && !guestMode);
  const showInvite = Boolean(meeting?.id && !guestMode);
  const avatarPeople = participants.slice(0, HEADER_AVATARS);
  const overflowCount = Math.max(0, participants.length - HEADER_AVATARS);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-app-shell px-3 sm:gap-4 sm:px-4">
        <div className="min-w-0 flex-1">
          {meetingsHref ? (
            <nav aria-label={t("meetings.title")} className="truncate text-caption text-muted-foreground">
              {workspaceLabel ? (
                <>
                  <span>{workspaceLabel}</span>
                  <span aria-hidden className="mx-1.5 text-muted-foreground/60">
                    /
                  </span>
                </>
              ) : null}
              <AppLink href={meetingsHref} className="hover:text-foreground">
                {t("meetings.title")}
              </AppLink>
            </nav>
          ) : null}
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-title-sm font-semibold text-foreground">{title}</h1>
            {subtitle ? (
              <p className="hidden truncate text-caption text-muted-foreground sm:block">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden items-center gap-1 rounded-full border border-border px-2 py-1 text-caption text-muted-foreground sm:inline-flex">
            <Users aria-hidden className="size-3.5" />
            {t("meetings.participantCount", { count: participants.length })}
          </span>

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
                "hidden items-center gap-1 rounded-full border px-2 py-1 text-caption tabular-nums sm:inline-flex",
                pastScheduledEnd || urgent
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              <Clock aria-hidden className="size-3.5" />
              {pastScheduledEnd
                ? t("meetings.pastScheduledEndShort")
                : remaining}
            </span>
          ) : null}

          {showHostActions && scheduled && meeting ? (
            <Button type="button" size="sm" disabled={start.isPending} onClick={() => start.mutate(meeting.id)}>
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

          {avatarPeople.length > 0 ? (
            <div className="hidden items-center lg:flex" aria-hidden>
              <div className="flex -space-x-2">
                {avatarPeople.map((p) => (
                  <MeetingPersonAvatar
                    key={p.identity}
                    name={p.name || p.identity}
                    size="sm"
                    className="ring-2 ring-app-shell"
                  />
                ))}
              </div>
              {overflowCount > 0 ? (
                <span className="ml-1.5 text-caption tabular-nums text-muted-foreground">
                  {t("meetings.moreParticipantsShort", { count: overflowCount })}
                </span>
              ) : null}
            </div>
          ) : null}

          {showInvite ? (
            <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden className="size-4" />
              <span className="hidden sm:inline">{t("meetings.inviteToMeeting")}</span>
            </Button>
          ) : null}

          {onToggleSidebar ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={sidebarOpen ? t("meetings.closeSidebar") : t("meetings.openSidebarPanel")}
              aria-pressed={sidebarOpen}
              onClick={onToggleSidebar}
            >
              {sidebarOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
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

      {meeting?.id ? (
        <CreateInviteLinkDialog meetingId={meeting.id} open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}
    </>
  );
}
