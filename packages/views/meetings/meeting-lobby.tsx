"use client";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useCreateJoinRequest } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";

export function lobbyMessage(t: (key: string) => string, decision: string | undefined, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "livekit_not_configured") return t("meetings.notConfigured");
    if (error.code === "meeting_not_started") return t("meetings.waitingForHost");
    if (error.code === "meeting_ended") return t("meetings.endedCannotJoin");
    if (error.code === "meeting_past_scheduled_end") return t("meetings.pastScheduledEnd");
    if (error.code === "meeting_canceled") return t("meetings.canceledCannotJoin");
    if (error.code === "unauthorized" || error.code === "access_grant_not_found") {
      return t("meetings.loginRequired");
    }
    if (error.code === "invite_link_invalid" || error.code === "invite_link_limit_reached") {
      return t("meetings.publicInviteInvalidLink");
    }
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

export function MeetingLobby({
  meetingId,
  title,
  decision,
  error,
  allowJoinRequest,
  canStart,
  starting,
  onStart,
  onLeave,
}: {
  meetingId: string;
  title?: string;
  decision: string | undefined;
  error: unknown;
  allowJoinRequest?: boolean;
  /** Host may start a scheduled meeting that has not begun yet. */
  canStart?: boolean;
  starting?: boolean;
  onStart?: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const request = useCreateJoinRequest(meetingId);
  const waitingApproval = decision === "WAITING_APPROVAL";
  const waitingForHost = decision === "WAITING_FOR_HOST";
  const showRequest = allowJoinRequest && decision === "DENY" && !waitingApproval;
  const showStart = Boolean(canStart && waitingForHost && onStart);

  return (
    <div role="status" className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
      {title ? <p className="line-clamp-2 max-w-md text-pretty text-title-sm font-semibold text-foreground">{title}</p> : null}
      <p className="max-w-md text-pretty text-body text-muted-foreground">{lobbyMessage(t, decision, error)}</p>
      {waitingApproval ? <p className="text-label text-muted-foreground">{t("meetings.requestSent")}</p> : null}
      {showStart ? (
        <Button size="sm" disabled={starting} onClick={onStart}>
          {t("meetings.start")}
        </Button>
      ) : null}
      {showRequest ? (
        <Button
          size="sm"
          disabled={request.isPending}
          onClick={() => request.mutate()}
        >
          {t("meetings.requestToJoin")}
        </Button>
      ) : null}
      <Button variant="outline" onClick={onLeave}>
        {t("meetings.leave")}
      </Button>
    </div>
  );
}
