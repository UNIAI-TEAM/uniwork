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
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { MeetingCanvas } from "./meeting-canvas";
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
    if (error.code === "unauthorized" || error.code === "access_grant_not_found") {
      return t(guestMode ? "meetings.guestSessionExpired" : "meetings.loginRequired");
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

  const back = (
    <Button type="button" variant="outline" onClick={onLeave}>
      <ArrowLeft aria-hidden />
      {t("common.back")}
    </Button>
  );

  if (isWaitingScreen) {
    const hint = waitingApproval
      ? t("meetings.waitingApprovalHint")
      : waitingForHost
        ? t("meetings.waitingForHostHint")
        : t("meetings.waitingForProviderHint");
    const statusTitle = waitingApproval
      ? t("meetings.waitingApprovalTitle")
      : waitingForHost
        ? t("meetings.waitingForHostTitle")
        : t("meetings.waitingForProviderTitle");

    return (
      <MeetingCanvas className="overflow-y-auto">
        <div className="m-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-12 text-center">
          <IconTile icon={waitingApproval ? UserCheck : Hourglass} size="lg" tone="info" />
          <div className="space-y-1.5">
            <p className="text-overline text-muted-foreground">{statusTitle}</p>
            {title ? (
              <h1 className="line-clamp-2 text-balance text-title-lg font-semibold text-foreground">{title}</h1>
            ) : null}
          </div>
          <div className="flex w-full items-start gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3.5 text-left shadow-surface">
            <Spinner className="mt-0.5 size-4 shrink-0 text-info motion-reduce:animate-none" />
            <div className="min-w-0 flex-1">
              <p role="status" className="text-pretty text-body font-medium text-foreground">
                {message}
              </p>
              <p className="mt-1 text-pretty text-label text-muted-foreground">{hint}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {showStart ? (
              <Button type="button" disabled={starting} aria-busy={starting || undefined} onClick={onStart}>
                {starting ? <Spinner className="size-4 motion-reduce:animate-none" /> : null}
                {t("meetings.start")}
              </Button>
            ) : null}
            {back}
          </div>
        </div>
      </MeetingCanvas>
    );
  }

  const gate = lobbyGate(decision, error);
  return (
    <MeetingGateScreen
      icon={gate.icon}
      tone={gate.tone}
      title={message}
      meetingTitle={title}
      alert={gate.tone === "destructive"}
      actions={
        <>
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
