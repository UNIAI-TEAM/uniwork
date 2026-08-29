"use client";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useCreateJoinRequest } from "@uniwork/core/meetings";
import { Clock, ShieldAlert } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";

export function lobbyMessage(t: (key: string) => string, decision: string | undefined, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "livekit_not_configured") return t("meetings.notConfigured");
    if (error.code === "meeting_not_started") return t("meetings.waitingForHost");
    if (error.code === "meeting_ended") return t("meetings.endedCannotJoin");
    if (error.code === "meeting_canceled") return t("meetings.canceledCannotJoin");
    return t("common.error");
  }
  switch (decision) {
    case "WAITING_FOR_HOST":
      return t("meetings.waitingForHost");
    case "WAITING_APPROVAL":
      return t("meetings.waitingApproval");
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
  onLeave,
}: {
  meetingId: string;
  title?: string;
  decision: string | undefined;
  error: unknown;
  allowJoinRequest?: boolean;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const request = useCreateJoinRequest(meetingId);
  const waitingApproval = decision === "WAITING_APPROVAL";
  const showRequest = allowJoinRequest && decision === "DENY" && !waitingApproval;
  const waiting = waitingApproval || decision === "WAITING_FOR_HOST";
  const Icon = waiting ? Clock : ShieldAlert;

  return (
    <div role="status" className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-6" />
      </span>
      {title ? <p className="max-w-md truncate text-title-sm font-semibold text-foreground">{title}</p> : null}
      <p className="max-w-md text-pretty text-body text-muted-foreground">{lobbyMessage(t, decision, error)}</p>
      {waitingApproval ? <p className="text-label text-muted-foreground">{t("meetings.requestSent")}</p> : null}
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
