"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clock,
  PanelRightClose,
  PanelRightOpen,
  UserPlus,
} from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import { useTranslation } from "react-i18next";
import { isPastScheduledEnd, useEndMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import type { Meeting } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { toastApiError } from "../toast-api-error";
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
// A landscape phone (390px tall) gets one header line: breadcrumb and description go.
const SHORT_HIDDEN = "[@media(max-height:500px)]:hidden";

/**
 * The countdown ticks on its own, so the header around it does not repaint
 * every second. It shows seconds, so it ticks every second: a slower tick
 * would freeze the seconds and then jump.
 */
function RemainingTimeChip({ endsAt }: { endsAt: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const msLeft = Date.parse(endsAt) - now;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = formatRemaining(endsAt, now);
  if (!remaining) return null;
  const pastScheduledEnd = isPastScheduledEnd(endsAt, now);
  const urgent = !pastScheduledEnd && msLeft <= URGENT_MS;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold tabular-nums",
        pastScheduledEnd || urgent
          ? "bg-destructive-solid text-on-solid"
          : "border border-meeting-bar-border bg-background text-foreground",
      )}
      data-testid="meeting-remaining-time"
    >
      <Clock aria-hidden className="size-3.5 shrink-0 opacity-90" />
      {pastScheduledEnd ? t("meetings.pastScheduledEndShort") : remaining}
    </span>
  );
}

/**
 * Always mounted, so a screen reader hears when recording starts or stops —
 * for everyone in the room, not only the host who pressed the button.
 */
function RecordingAnnouncer({ recording }: { recording: boolean }) {
  const { t } = useTranslation();
  const previous = useRef(recording);
  const [text, setText] = useState("");

  useEffect(() => {
    if (previous.current === recording) return;
    previous.current = recording;
    setText(t(recording ? "meetings.recordingStarted" : "meetings.recordingStopped"));
  }, [recording, t]);

  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-recording-announcer">
      {text}
    </p>
  );
}

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
  onOpenPeople,
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
  onOpenPeople?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const participants = useParticipants();
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const start = useStartMeeting(workspaceId ?? "");
  const end = useEndMeeting(workspaceId ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

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
        className="relative z-20 shrink-0 border-b border-meeting-bar-border bg-meeting-stage px-3 py-2 sm:px-4 sm:py-2.5 [@media(max-height:500px)]:py-1.5"
        data-testid="meeting-stage-header"
      >
        <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-3">
          <div className="min-w-0">
            {meetingsHref && !guestMode ? (
              <nav
                aria-label={t("meetings.title")}
                className={cn("mb-0.5 truncate text-caption text-meeting-bar-muted-foreground", SHORT_HIDDEN)}
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
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0 [@media(max-height:500px)]:flex-nowrap">
              <h1 className="min-w-0 max-w-full truncate text-title-sm font-semibold text-meeting-bar-foreground">
                {title}
              </h1>
              {scheduleRange && meeting ? (
                <>
                  <span aria-hidden className="shrink-0 text-meeting-bar-muted-foreground">
                    ·
                  </span>
                  <time
                    dateTime={`${meeting.starts_at}/${meeting.ends_at}`}
                    className="min-w-0 truncate text-caption text-meeting-bar-muted-foreground tabular-nums"
                  >
                    {scheduleRange}
                  </time>
                </>
              ) : null}
            </div>
            {description ? (
              <p className={cn("mt-0.5 truncate text-caption text-meeting-bar-muted-foreground", SHORT_HIDDEN)}>
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
            <RecordingAnnouncer recording={recording} />
            {recording ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-destructive-solid px-2 py-1 text-caption font-medium text-on-solid"
                data-testid="meeting-rec-badge"
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-on-solid"
                />
                {t("meetings.recording")}
              </span>
            ) : null}

            {meeting?.ends_at ? <RemainingTimeChip endsAt={meeting.ends_at} /> : null}

            {showInvite ? (
              <Button
                type="button"
                variant="meetingChip"
                size="sm"
                className="h-8 px-2 sm:px-2.5"
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus aria-hidden className="size-4" />
                <span className="sr-only sm:not-sr-only sm:max-w-[8rem] sm:truncate">{t("meetings.shareGuestLink")}</span>
              </Button>
            ) : null}

            {showHostActions && inProgress && meeting ? (
              <Button
                type="button"
                variant="destructiveSolid"
                size="sm"
                className="h-8 px-2.5 font-semibold"
                disabled={end.isPending}
                onClick={() => setEndConfirmOpen(true)}
              >
                {t("meetings.end")}
              </Button>
            ) : null}

            {showHostActions && scheduled && meeting ? (
              // Reachable at every width: a host on a phone must be able to start.
              <Button
                type="button"
                variant="brand"
                size="sm"
                className="h-8 px-2.5 font-semibold"
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
                      className="ring-2 ring-meeting-stage"
                    />
                  ))}
                </div>
                {overflowCount > 0 ? (
                  <span className="ml-1.5 text-caption tabular-nums text-meeting-bar-muted-foreground">
                    {t("meetings.moreParticipantsShort", { count: overflowCount })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {showHostActions && meeting?.id ? (
              <MeetingAdmitGuestsButton meetingId={meeting.id} onOpenPeople={onOpenPeople} />
            ) : null}

            {onOpenSidebar ? (
              <Button
                type="button"
                variant="meetingChip"
                size="icon"
                className="size-9 lg:hidden"
                aria-label={t("meetings.openSidebarPanel")}
                onClick={onOpenSidebar}
              >
                <PanelRightOpen aria-hidden />
              </Button>
            ) : null}

            {onToggleSidebar ? (
              <Button
                type="button"
                variant="meetingChip"
                size="icon"
                className="hidden size-9 lg:inline-flex"
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

      <AlertDialog open={endConfirmOpen} onOpenChange={setEndConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meetings.endConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("meetings.endConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.back")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={end.isPending}
              onClick={() => {
                if (!meeting) return;
                end.mutate(meeting.id, { onError: (err) => toastApiError(err, t("common.error")) });
                setEndConfirmOpen(false);
              }}
            >
              {t("meetings.confirmEnd")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
