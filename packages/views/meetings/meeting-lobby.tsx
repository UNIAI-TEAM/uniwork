"use client";
import { PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useCreateJoinRequest } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { MEETING_DARK_BAR } from "./meeting-dark-bar";
import { MeetingLobbyBackground } from "./meeting-lobby-background";
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

const LOBBY_ACTION =
  "h-11 w-full gap-2 rounded-xl text-body font-medium sm:min-w-0";

function LobbyControlBar({
  onLeave,
  children,
}: {
  onLeave: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const dual = Boolean(children);

  return (
    <footer className="flex shrink-0 justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
      <div
        className={cn(
          MEETING_DARK_BAR,
          "w-full sm:max-w-md",
          dual ? "grid max-w-sm grid-cols-2 gap-2" : "flex max-w-xs justify-center",
        )}
      >
        {children}
        <Button
          type="button"
          variant="destructive"
          className={cn(LOBBY_ACTION, !dual && "min-w-40 px-6")}
          onClick={onLeave}
        >
          <PhoneOff aria-hidden className="size-5" />
          {t("meetings.leave")}
        </Button>
      </div>
    </footer>
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
      <MeetingLobbyBackground>
        <div
          role="status"
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8"
        >
          <div className="grid w-full max-w-3xl gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14">
            <div className="flex justify-center lg:justify-end">
              <MeetingWaitingIllustration
                variant={illustrationVariant}
                className="max-w-[13rem] sm:max-w-xs md:max-w-sm"
              />
            </div>
            <div className="flex flex-col gap-5 text-center lg:text-left">
              <div className="space-y-2.5">
                <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  {statusTitle}
                </p>
                {title ? (
                  <h1 className="line-clamp-2 text-balance text-display-sm font-semibold tracking-tight text-foreground">
                    {title}
                  </h1>
                ) : null}
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface-raised px-5 py-5 shadow-[var(--floating-shadow)] sm:px-6 sm:py-6">
                <div className="flex items-start gap-3.5 sm:items-center">
                  <Spinner className="mt-0.5 size-5 shrink-0 text-brand sm:mt-0" />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-pretty text-body font-medium text-foreground">{message}</p>
                    <p className="mt-2 text-pretty text-label leading-relaxed text-muted-foreground">{hint}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <LobbyControlBar onLeave={onLeave}>
          {showStart ? (
            <Button type="button" disabled={starting} onClick={onStart} className={LOBBY_ACTION}>
              {starting ? <Spinner className="size-4" /> : null}
              {t("meetings.start")}
            </Button>
          ) : null}
        </LobbyControlBar>
      </MeetingLobbyBackground>
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
