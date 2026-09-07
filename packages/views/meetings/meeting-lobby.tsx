"use client";
import { PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useCreateJoinRequest } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingWaitingIllustration } from "./meeting-waiting-illustration";

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

function LobbyControlBar({
  onLeave,
  children,
}: {
  onLeave: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 justify-center px-4 pb-6 pt-2">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-surface-border bg-surface p-2 shadow-[var(--floating-shadow)] sm:p-2.5">
        {children}
        <Button
          type="button"
          variant="destructive"
          className="h-11 gap-2 rounded-xl px-4"
          onClick={onLeave}
        >
          <PhoneOff aria-hidden className="size-5" />
          {t("meetings.leave")}
        </Button>
      </div>
    </div>
  );
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
  const waitingForProvider = decision === "WAITING_FOR_PROVIDER";
  const isWaitingScreen = waitingApproval || waitingForHost || waitingForProvider;
  const showRequest = allowJoinRequest && decision === "DENY" && !waitingApproval;
  const showStart = Boolean(canStart && waitingForHost && onStart);
  const message = lobbyMessage(t, decision, error);

  if (isWaitingScreen) {
    const illustrationVariant = waitingApproval ? "approval" : "host";
    const hint = waitingApproval
      ? t("meetings.waitingApprovalHint")
      : waitingForHost
        ? t("meetings.waitingForHostHint")
        : t("meetings.waitingForProviderHint");
    const statusTitle = waitingApproval ? t("meetings.waitingApprovalTitle") : t("meetings.prejoinTitle");

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div
          role="status"
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8"
        >
          <div className="grid w-full max-w-3xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div className="flex justify-center">
              <MeetingWaitingIllustration
                variant={illustrationVariant}
                className="max-w-[12rem] sm:max-w-xs md:max-w-sm"
              />
            </div>
            <div className="flex flex-col gap-4 text-center lg:text-left">
              <div className="space-y-2">
                <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  {statusTitle}
                </p>
                {title ? (
                  <h1 className="line-clamp-2 text-balance text-display-sm font-semibold tracking-tight text-foreground">
                    {title}
                  </h1>
                ) : null}
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface px-5 py-5 shadow-[var(--floating-shadow)] sm:px-6">
                <div className="flex items-start gap-3 sm:items-center">
                  <Spinner className="mt-0.5 size-5 shrink-0 text-brand sm:mt-0" />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-pretty text-body font-medium text-foreground">{message}</p>
                    <p className="mt-2 text-pretty text-label text-muted-foreground">{hint}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <LobbyControlBar onLeave={onLeave}>
          {showStart ? (
            <Button size="sm" disabled={starting} onClick={onStart}>
              {t("meetings.start")}
            </Button>
          ) : null}
        </LobbyControlBar>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        showRequest || error ? "items-center justify-center gap-3 p-6 text-center" : "dark bg-rail",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        {title ? (
          <h1 className="line-clamp-2 max-w-md text-pretty text-title font-semibold text-foreground">{title}</h1>
        ) : null}
        <p className="max-w-md text-pretty text-body text-muted-foreground">{message}</p>
        {showStart ? (
          <Button size="sm" disabled={starting} onClick={onStart}>
            {t("meetings.start")}
          </Button>
        ) : null}
        {showRequest ? (
          <Button size="sm" disabled={request.isPending} onClick={() => request.mutate()}>
            {t("meetings.requestToJoin")}
          </Button>
        ) : null}
      </div>
      <LobbyControlBar onLeave={onLeave} />
    </div>
  );
}
