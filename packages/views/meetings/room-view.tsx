"use client";
import { LiveKitRoom, useRoomContext } from "@livekit/components-react";
import "@livekit/components-styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarX2, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import type { JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { isJoinAdmitted, useJoinMeeting, useMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useMeetingLobbySync, useMeetingScope, useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { MeetingConference } from "./meeting-conference";
import { MeetingProactiveTokenRefresh } from "./meeting-proactive-token-refresh";
import { MeetingLobby } from "./meeting-lobby";
import { MeetingGateScreen } from "./meeting-gate-screen";
import { MeetingMediaError } from "./meeting-media-error";
import { MeetingPreJoin, type PreJoinChoice } from "./meeting-prejoin";
import {
  isMediaDeviceError,
  MeetingRoomDeviceNotice,
  roomDeviceFailure,
  type RoomDeviceFailures,
  type RoomDeviceKind,
} from "./meeting-room-device-notice";
import { useMeetingScheduleDeadline } from "./use-meeting-schedule-deadline";
import {
  mediaDisconnectKind,
  roomClosedReason,
  shouldLeaveOnDisconnect,
  shouldRefreshCredentialOnDisconnect,
  type MediaDisconnectKind,
} from "./room-disconnect";
import { useFocusHeadingOnViewChange } from "./use-focus-heading-on-view-change";
import { useInertOutside } from "./use-inert-outside";
import { isRetryableJoinError } from "./room-connection";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";
import { useWithdrawJoinRequestOnLeave } from "./use-withdraw-join-request";
import { SCREEN_SHARE_PUBLISH_DEFAULTS, useSharpScreenShares } from "./share-adaptive-stream";

function MeetingRoomShell({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useInertOutside(ref);
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Screen shares in this room ask for device pixels (see share-adaptive-stream). */
function MeetingSharpShares() {
  useSharpScreenShares(useRoomContext());
  return null;
}

export function MeetingRoomView({
  meetingId,
  workspaceId,
  joinBody,
  guestMode,
  meetingTitle,
  initialJoinDecision,
  initialChoice,
  invite,
  onLeave,
  meetingsHref,
  workspaceLabel,
}: {
  meetingId: string;
  workspaceId?: string;
  joinBody?: JoinMeetingBody;
  /** Public invite flow: skip workspace-scoped APIs that require a member session. */
  guestMode?: boolean;
  meetingTitle?: string;
  initialJoinDecision?: JoinDecision;
  /** Guest invite prejoin; applied when skipping the member prejoin screen. */
  initialChoice?: PreJoinChoice;
  /** Public-link credentials for someone outside the workspace; every join carries them. */
  invite?: { linkId: string; secret: string };
  onLeave: () => void;
  meetingsHref?: string;
  workspaceLabel?: string;
}) {
  const { t } = useTranslation();
  const join = useJoinMeeting();
  // A second mutation: a new mutate clears `data` until it settles, and the
  // room renders from join.data — refreshing through `join` unmounted
  // LiveKitRoom mid-call, which dropped any screen share.
  const credentialRefresh = useJoinMeeting();
  // isLoading, not isPending: a disabled (guest) query reports pending forever.
  const { data: meeting, isLoading: meetingLoading } = useMeeting(meetingId, { enabled: !guestMode });
  const resolvedWorkspaceId = guestMode ? (workspaceId ?? "") : (workspaceId ?? meeting?.workspace_id ?? "");
  const start = useStartMeeting(resolvedWorkspaceId);
  const { canHost } = useMeetingPermissions(guestMode ? null : (meeting ?? null), resolvedWorkspaceId);
  useWorkspaceEvents(guestMode ? "" : resolvedWorkspaceId);
  // In-room events reach only the sockets holding the meeting open. Held from
  // the prejoin on: a member waiting for approval hears its decision there.
  useMeetingScope(guestMode ? "" : meetingId);
  useMeetingLobbySync(meetingId, guestMode === true);
  const joinOnce = useRef(false);
  const admittedRef = useRef(false);
  const credentialRefreshAttempts = useRef(0);
  const [mediaErrorKind, setMediaErrorKind] = useState<MediaDisconnectKind | null>(null);
  const [closedReason, setClosedReason] = useState<"ended" | "canceled" | "removed" | null>(null);
  const [deviceFailures, setDeviceFailures] = useState<RoomDeviceFailures>({});
  const clearDeviceFailure = useCallback((kind: RoomDeviceKind) => {
    setDeviceFailures((prev) => {
      if (!prev[kind]) return prev;
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  }, []);
  const [choice, setChoice] = useState<PreJoinChoice | null>(() => {
    if (initialChoice) return initialChoice;
    return isJoinAdmitted(initialJoinDecision) ? { audio: false, video: false } : null;
  });
  const mutateJoin = join.mutate;
  const mutateRefreshAsync = credentialRefresh.mutateAsync;
  const joinArgs = useMemo(() => {
    const base = joinBody ? { meetingId, ...joinBody } : { meetingId };
    if (invite) {
      return { ...base, invite_link_id: invite.linkId, secret: invite.secret };
    }
    return base;
  }, [meetingId, joinBody, invite]);

  const [rejoining, setRejoining] = useState(false);
  const retryJoin = useCallback(() => {
    setMediaErrorKind(null);
    setRejoining(false);
    mutateJoin(joinArgs);
  }, [mutateJoin, joinArgs]);

  // A dropped room re-joins in place: the last admitted credential keeps
  // LiveKitRoom mounted while the new one is fetched, and the new token prop
  // reconnects the same Room — no skeleton, and the stage, chat and panels
  // keep their state. The rare identical token (two joins in one second)
  // would not reconnect, so it remounts the room instead.
  const [roomEpoch, setRoomEpoch] = useState(0);
  const roomTokenRef = useRef<string | undefined>(undefined);
  const lastAdmittedRef = useRef<JoinDecision | undefined>(undefined);
  const lastLobbyRef = useRef<JoinDecision | undefined>(undefined);
  const rejoinAfterDrop = useCallback(() => {
    setRejoining(true);
    mutateJoin(joinArgs, {
      onSuccess: (result) => {
        if (result?.participant_token && result.participant_token === roomTokenRef.current) {
          setRoomEpoch((n) => n + 1);
        }
      },
      onSettled: () => setRejoining(false),
    });
  }, [mutateJoin, joinArgs]);

  const requestAgain = useCallback(() => {
    mutateJoin({ ...joinArgs, request_again: true });
  }, [mutateJoin, joinArgs]);

  const refreshLiveKitCredential = useCallback(async () => {
    try {
      const result = await mutateRefreshAsync(joinArgs);
      if (!result || !isJoinAdmitted(result) || !result.participant_token) return null;
      return { token: result.participant_token, expires_at: result.expires_at };
    } catch {
      return null;
    }
  }, [mutateRefreshAsync, joinArgs]);

  const handleStartMeeting = useCallback(() => {
    start.mutate(meetingId, {
      onSuccess: () => retryJoin(),
      // Someone else (a co-host or an admin) started it first: the room is
      // open, so join it rather than report a failure.
      onError: (err) => {
        if (err instanceof ApiError && err.code === "invalid_meeting_state") retryJoin();
      },
    });
  }, [start, meetingId, retryJoin]);
  const startError =
    start.error instanceof ApiError && start.error.code === "invalid_meeting_state" ? null : start.error;

  useEffect(() => {
    if (!choice) return;
    if (joinOnce.current) return;
    joinOnce.current = true;
    if (isJoinAdmitted(initialJoinDecision)) return;
    retryJoin();
  }, [choice, retryJoin, initialJoinDecision]);

  const settledDecision = join.data ?? initialJoinDecision;
  if (isJoinAdmitted(settledDecision)) {
    lastAdmittedRef.current = settledDecision;
    lastLobbyRef.current = undefined;
  } else if (settledDecision) {
    lastLobbyRef.current = settledDecision;
  }
  // Only while that re-join is in flight: a superseded call never runs its
  // onSettled, and the flag must not pin an old credential after it.
  const holdLastAdmitted = rejoining && join.isPending && lastAdmittedRef.current;
  // The lobby re-asks when its own request is decided, when the meeting
  // starts or closes, on reconnect and on backoff, and a new mutate empties
  // join.data until it settles. Keep the last lobby answer meanwhile, so the
  // screen does not flash "connecting", focus does not jump back to the
  // heading, and a leave mid-retry still withdraws the knock. A 429/503 is not
  // a refusal either: the lobby holds while useLobbyJoinRetry waits it out.
  const joinRetryable = isRetryableJoinError(join.error);
  const holdLastLobby =
    !holdLastAdmitted &&
    ((join.isPending && !join.error) || joinRetryable) &&
    !settledDecision &&
    lastLobbyRef.current;
  const joinError = holdLastLobby ? null : join.error;
  const decision = holdLastAdmitted
    ? lastAdmittedRef.current
    : holdLastLobby
      ? lastLobbyRef.current
      : settledDecision;
  const admitted = isJoinAdmitted(decision);
  admittedRef.current = admitted;

  // LiveKit JWT refresh: proactive timer patches room.engine.token (no
  // room.connect remount). Unexpected disconnect still re-joins via retryJoin.
  useLobbyJoinRetry({
    meetingId,
    decision: decision?.decision,
    admitted,
    hasJoinError: Boolean(join.error),
    joinError: join.error,
    joinRequestId: decision?.join_request_id,
    onRetry: retryJoin,
  });

  // Guests withdraw through the public invite flow, which owns their request.
  const waitingRequestId =
    !guestMode && !admitted && decision?.decision === "WAITING_APPROVAL" ? decision.join_request_id : undefined;
  useWithdrawJoinRequestOnLeave(meetingId, waitingRequestId);

  // Prejoin → lobby and one lobby state → another swap the whole screen;
  // focus follows to the new heading so the change is heard (the guest
  // invite page does the same). Entering the room itself is left alone.
  const joinErrorCode = joinError instanceof ApiError ? joinError.code : joinError ? "error" : "";
  // Being removed, or the call closing around you, swaps the room for a
  // screen that says why; focus moves there too instead of staying on a tile
  // that no longer exists.
  const lobbyView = closedReason
    ? `closed:${closedReason}`
    : !choice
    ? "prejoin"
    : !admitted && (joinError || decision)
      ? `lobby:${decision?.decision ?? ""}:${joinErrorCode}`
      : "room";
  useFocusHeadingOnViewChange(lobbyView, { selector: "[data-gate-heading]", fallback: null });

  useMeetingScheduleDeadline({
    endsAt: meeting?.ends_at,
    status: meeting?.status,
    admitted,
    onClosed: setClosedReason,
  });

  if (!choice) {
    return (
      <MeetingRoomShell testId="meeting-prejoin">
        <MeetingPreJoin
          meeting={meeting ?? undefined}
          loading={!guestMode && meetingLoading}
          onJoin={setChoice}
          onLeave={onLeave}
        />
      </MeetingRoomShell>
    );
  }

  // A later re-join (token refresh) must not eject an admitted session on a
  // transient error — join.error would otherwise unmount LiveKit.
  if (!admitted && (joinError || decision)) {
    return (
      <MeetingRoomShell>
        <MeetingLobby
          title={meeting?.title ?? meetingTitle}
          decision={decision?.decision}
          error={joinError}
          guestMode={guestMode}
          meetingStatus={decision?.meeting_status ?? meeting?.status}
          onRequestAgain={requestAgain}
          requestingAgain={join.isPending}
          onRetry={retryJoin}
          canStart={canHost.allowed}
          // A started meeting still has the join to come; the button stays
          // busy until the room answers, so it cannot be pressed twice.
          starting={start.isPending || (start.isSuccess && join.isPending)}
          onStart={handleStartMeeting}
          startError={startError}
          onLeave={onLeave}
        />
      </MeetingRoomShell>
    );
  }

  if (!admitted || !decision?.server_url || !decision.participant_token) {
    return (
      <MeetingRoomShell>
        <div
          role="status"
          className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <div aria-hidden className="grid w-full max-w-md grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-video rounded-2xl bg-meeting-stage" />
            ))}
          </div>
          {(meeting?.title ?? meetingTitle) ? (
            <p className="max-w-md truncate text-title-sm font-semibold text-foreground">
              {meeting?.title ?? meetingTitle}
            </p>
          ) : null}
          <p className="text-body text-muted-foreground">
            {join.isPending ? t("meetings.joining") : t("meetings.connecting")}
          </p>
          <Button variant="outline" onClick={onLeave}>
            {t("meetings.leave")}
          </Button>
        </div>
      </MeetingRoomShell>
    );
  }

  if (closedReason) {
    const removed = closedReason === "removed";
    return (
      <MeetingRoomShell>
        <MeetingGateScreen
          icon={removed ? UserX : CalendarX2}
          tone={removed ? "destructive" : "muted"}
          meetingTitle={meeting?.title ?? meetingTitle}
          title={t(
            removed
              ? "meetings.removedFromMeeting"
              : closedReason === "canceled"
                ? "meetings.canceledCannotJoin"
                : "meetings.endedCannotJoin",
          )}
          actions={
            <Button variant="outline" onClick={onLeave}>
              <ArrowLeft aria-hidden />
              {guestMode ? t("common.back") : t("meetings.backToMeeting")}
            </Button>
          }
        />
      </MeetingRoomShell>
    );
  }

  if (mediaErrorKind) {
    return (
      <MeetingRoomShell>
        <MeetingMediaError
          kind={mediaErrorKind}
          meetingTitle={meeting?.title ?? meetingTitle}
          guestMode={guestMode}
          onRetry={() => {
            credentialRefreshAttempts.current = 0;
            retryJoin();
          }}
          onLeave={onLeave}
        />
      </MeetingRoomShell>
    );
  }

  roomTokenRef.current = decision.participant_token;
  return (
    <MeetingRoomShell testId="meeting-stage">
      <LiveKitRoom
        key={roomEpoch}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        serverUrl={decision.server_url}
        token={decision.participant_token}
        connect
        video={
          choice.video
            ? choice.videoDeviceId
              ? { deviceId: choice.videoDeviceId }
              : true
            : false
        }
        audio={
          choice.audio
            ? choice.audioDeviceId
              ? { deviceId: choice.audioDeviceId }
              : true
            : false
        }
        options={{
          adaptiveStream: true,
          dynacast: true,
          // A share goes out as ~1080p plus a 720p backup; MeetingSharpShares
          // makes Retina viewers ask for the 1080p one.
          publishDefaults: SCREEN_SHARE_PUBLISH_DEFAULTS,
        }}
        onError={(error) => {
          // A microphone or camera that will not start is not a lost room:
          // onMediaDeviceFailure keeps the viewer in with that track off.
          if (isMediaDeviceError(error)) return;
          setMediaErrorKind((kind) => kind ?? "connection");
        }}
        onMediaDeviceFailure={(failure, kind) => {
          // No kind: a cancelled screen-share picker, which needs no notice.
          if (kind !== "audioinput" && kind !== "videoinput") return;
          setDeviceFailures((prev) => ({ ...prev, [kind]: roomDeviceFailure(failure) }));
        }}
        onDisconnected={(reason) => {
          const kind = mediaDisconnectKind(reason);
          if (kind === "replaced") {
            setMediaErrorKind("replaced");
            return;
          }
          if (shouldLeaveOnDisconnect(reason)) {
            // Say why before sending anyone away: the host ended the call, or removed us.
            setClosedReason(roomClosedReason(reason) ?? "ended");
            return;
          }
          if (!admittedRef.current || !shouldRefreshCredentialOnDisconnect(reason)) {
            setMediaErrorKind("connection");
            return;
          }
          if (credentialRefreshAttempts.current >= 2) {
            setMediaErrorKind("connection");
            return;
          }
          credentialRefreshAttempts.current += 1;
          rejoinAfterDrop();
        }}
      >
        <MeetingSharpShares />
        <MeetingProactiveTokenRefresh
          expiresAt={decision.expires_at}
          onRefresh={refreshLiveKitCredential}
        />
        <MeetingConference
          meetingId={meetingId}
          meeting={meeting ?? undefined}
          meetingTitle={meetingTitle}
          workspaceId={guestMode ? undefined : workspaceId}
          meetingsHref={guestMode ? undefined : meetingsHref}
          workspaceLabel={guestMode ? undefined : workspaceLabel}
          guestMode={guestMode}
          onLeave={onLeave}
          deviceNotice={
            <MeetingRoomDeviceNotice
              failures={deviceFailures}
              deviceIds={{ audioinput: choice.audioDeviceId, videoinput: choice.videoDeviceId }}
              onResolved={clearDeviceFailure}
            />
          }
        />
      </LiveKitRoom>
    </MeetingRoomShell>
  );
}
