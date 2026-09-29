"use client";
import {
  ArrowLeft,
  Ban,
  CalendarX2,
  Clock,
  Hourglass,
  Link2Off,
  Lock,
  ServerCog,
  TriangleAlert,
  UserCheck,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import type { IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { MeetingGateScreen } from "./meeting-gate-screen";

const INVALID_LINK_CODES = new Set([
  "invite_link_invalid",
  "invite_link_revoked",
  "invite_link_expired",
  "invite_link_limit_reached",
]);

/**
 * The sentence a lobby shows for a decision or a join error. A guest never
 * sees infrastructure names or raw server text: they cannot act on either.
 */
export function lobbyMessage(
  t: (key: string) => string,
  decision: string | undefined,
  error: unknown,
  guestMode = false,
): string {
  if (error instanceof ApiError) {
    if (error.code === "livekit_not_configured") {
      return t(guestMode ? "meetings.roomNotReady" : "meetings.notConfigured");
    }
    if (error.code === "meeting_not_started") return t("meetings.waitingForHost");
    if (error.code === "meeting_ended") return t("meetings.endedCannotJoin");
    if (error.code === "meeting_past_scheduled_end") return t("meetings.pastScheduledEnd");
    if (error.code === "meeting_canceled") return t("meetings.canceledCannotJoin");
    if (error.code === "unauthorized") {
      return t(guestMode ? "meetings.guestSessionExpired" : "meetings.loginRequired");
    }
    // A signed-in member without a grant is not invited; signing in again
    // would not help, so say who the meeting is for instead.
    if (error.code === "access_grant_not_found") {
      return t(guestMode ? "meetings.guestSessionExpired" : "meetings.inviteOnly");
    }
    if (error.code === "join_request_rejected") return t("meetings.joinRequestRejected");
    if (INVALID_LINK_CODES.has(error.code)) return t("meetings.publicInviteInvalidLink");
    if (guestMode) return t("meetings.joinFailed");
    return apiErrorMessage(error) ?? t("common.error");
  }
  switch (decision) {
    case "WAITING_FOR_HOST":
      return t("meetings.waitingForHost");
    case "WAITING_APPROVAL":
      return t("meetings.waitingApproval");
    case "WAITING_FOR_PROVIDER":
      return t("meetings.waitingForProvider");
    case "DENY":
      return t("meetings.denied");
    default:
      return t("common.error");
  }
}

/**
 * The line under a lobby title: what happens next, or what the person can do
 * about it. Guests only get copy that does not assume a workspace account.
 */
export function lobbyHint(
  t: (key: string) => string,
  decision: string | undefined,
  error: unknown,
  { guestMode = false, meetingStatus }: { guestMode?: boolean; meetingStatus?: string } = {},
): string | undefined {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "access_grant_not_found":
        return guestMode ? undefined : t("meetings.inviteOnlyHint");
      case "join_request_rejected":
        return t("meetings.joinRequestRejectedHint");
      case "meeting_ended":
        return guestMode ? undefined : t("meetings.endedHint");
      case "meeting_canceled":
        return t("meetings.canceledHint");
      case "meeting_past_scheduled_end":
        return t("meetings.pastScheduledEndHint");
      case "meeting_not_started":
        return t("meetings.waitingForHostHint");
      default:
        return undefined;
    }
  }
  if (error) return undefined;
  switch (decision) {
    case "WAITING_APPROVAL":
      // Knocking before the host has opened the room: nobody can admit yet.
      return meetingStatus === "SCHEDULED"
        ? t("meetings.waitingApprovalNotStartedHint")
        : t("meetings.waitingApprovalHint");
    case "WAITING_FOR_HOST":
      return t("meetings.waitingForHostHint");
    case "WAITING_FOR_PROVIDER":
      return t("meetings.waitingForProviderHint");
    default:
      return undefined;
  }
}

type GateAction = "requestAgain" | "retry" | null;

/** How a settled lobby state looks and what it lets you do next. */
function lobbyGate(decision: string | undefined, error: unknown): { icon: LucideIcon; tone: IconTileTone; action: GateAction } {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case "meeting_ended":
      return { icon: CalendarX2, tone: "muted", action: null };
    case "meeting_canceled":
      return { icon: Ban, tone: "muted", action: null };
    case "meeting_past_scheduled_end":
      return { icon: Clock, tone: "warning", action: null };
    // The session closed between the prejoin and the join: a wait, not a
    // fault. Nothing retries it by itself, so the retry stays.
    case "meeting_not_started":
      return { icon: Hourglass, tone: "info", action: "retry" };
    case "join_request_rejected":
      return { icon: UserX, tone: "destructive", action: "requestAgain" };
    case "unauthorized":
    case "access_grant_not_found":
      return { icon: Lock, tone: "muted", action: null };
    case "livekit_not_configured":
      return { icon: ServerCog, tone: "warning", action: "retry" };
    default:
      if (code && INVALID_LINK_CODES.has(code)) return { icon: Link2Off, tone: "destructive", action: null };
      if (code) return { icon: TriangleAlert, tone: "destructive", action: "retry" };
      return decision === "DENY"
        ? { icon: Lock, tone: "muted", action: null }
        : { icon: TriangleAlert, tone: "destructive", action: "retry" };
  }
}

export function MeetingLobby({
  title,
  decision,
  error,
  guestMode = false,
  meetingStatus,
  onRequestAgain,
  requestingAgain,
  onRetry,
  canStart,
  starting,
  onStart,
  onLeave,
}: {
  title?: string;
  decision: string | undefined;
  error: unknown;
  /** Public invite flow: guest-safe copy only. */
  guestMode?: boolean;
  /** The meeting's status, when known: a knock before the start reads differently. */
  meetingStatus?: string;
  /** Files a new join request after the host declined the last one. */
  onRequestAgain?: () => void;
  requestingAgain?: boolean;
  /** Runs the join again after a failure that may be temporary. */
  onRetry?: () => void;
  /** Host may start a scheduled meeting that has not begun yet. */
  canStart?: boolean;
  starting?: boolean;
  onStart?: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const waitingApproval = decision === "WAITING_APPROVAL";
  const waitingForHost = decision === "WAITING_FOR_HOST";
  const waitingForProvider = decision === "WAITING_FOR_PROVIDER";
  // A join error is final for this attempt: never keep the "page updates by
  // itself" spinner up next to it.
  const isWaitingScreen = !error && (waitingApproval || waitingForHost || waitingForProvider);
  const showStart = Boolean(canStart && waitingForHost && onStart && !error);
  const message = lobbyMessage(t, decision, error, guestMode);

  // A member's way out of the room lands on the meeting page; after the end
  // that is where the notes are, so the button says so.
  const endedForMember = !guestMode && error instanceof ApiError && error.code === "meeting_ended";
  const back = (
    <Button type="button" variant="outline" onClick={onLeave}>
      <ArrowLeft aria-hidden />
      {endedForMember ? t("meetings.backToMeeting") : t("common.back")}
    </Button>
  );

  // Waiting and refused share one layout: the meeting's name small on top,
  // the state as the heading, then what happens next. Moving from "waiting"
  // to "declined" changes the words, not the page.
  const gate = isWaitingScreen
    ? { icon: waitingApproval ? UserCheck : Hourglass, tone: "info" as const, action: null }
    : lobbyGate(decision, error);
  return (
    <MeetingGateScreen
      icon={gate.icon}
      tone={gate.tone}
      title={message}
      description={lobbyHint(t, decision, error, { guestMode, meetingStatus })}
      busy={isWaitingScreen}
      meetingTitle={title}
      alert={gate.tone === "destructive"}
      actions={
        <>
          {showStart ? (
            <Button type="button" disabled={starting} aria-busy={starting || undefined} onClick={onStart}>
              {starting ? <Spinner className="size-4 motion-reduce:animate-none" /> : null}
              {t("meetings.start")}
            </Button>
          ) : null}
          {gate.action === "requestAgain" && onRequestAgain ? (
            <Button type="button" disabled={requestingAgain} aria-busy={requestingAgain || undefined} onClick={onRequestAgain}>
              {t("meetings.requestAgain")}
            </Button>
          ) : null}
          {gate.action === "retry" && onRetry ? (
            <Button type="button" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : null}
          {back}
        </>
      }
    />
  );
}
