"use client";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { isJoinAdmitted, useJoinMeeting, useMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useMeetingLobbySync, useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { MeetingConference } from "./meeting-conference";
import { MeetingProactiveTokenRefresh } from "./meeting-proactive-token-refresh";
import { MeetingLobby } from "./meeting-lobby";
import { MeetingPreJoin, type PreJoinChoice } from "./meeting-prejoin";
import { useMeetingScheduleDeadline } from "./use-meeting-schedule-deadline";
import {
  mediaDisconnectKind,
  shouldLeaveOnDisconnect,
  shouldRefreshCredentialOnDisconnect,
  type MediaDisconnectKind,
} from "./room-disconnect";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";

function MeetingRoomShell({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid={testId}
    >
      {children}
    </div>
  );
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
  const { data: meeting } = useMeeting(meetingId, { enabled: !guestMode });
  const resolvedWorkspaceId = guestMode ? (workspaceId ?? "") : (workspaceId ?? meeting?.workspace_id ?? "");
  const start = useStartMeeting(resolvedWorkspaceId);
  const { canHost } = useMeetingPermissions(guestMode ? null : (meeting ?? null), resolvedWorkspaceId);
  useWorkspaceEvents(guestMode ? "" : resolvedWorkspaceId);
  useMeetingLobbySync(meetingId, guestMode === true);
  const joinOnce = useRef(false);
  const admittedRef = useRef(false);
  const credentialRefreshAttempts = useRef(0);
  const [mediaErrorKind, setMediaErrorKind] = useState<MediaDisconnectKind | null>(null);
  const [choice, setChoice] = useState<PreJoinChoice | null>(() => {
    if (initialChoice) return initialChoice;
    return isJoinAdmitted(initialJoinDecision) ? { audio: false, video: false } : null;
  });
  const mutateJoin = join.mutate;
  const mutateJoinAsync = join.mutateAsync;
  const joinArgs = useMemo(() => {
    const base = joinBody ? { meetingId, ...joinBody } : { meetingId };
    if (invite) {
      return { ...base, invite_link_id: invite.linkId, secret: invite.secret };
    }
    return base;
  }, [meetingId, joinBody, invite]);

  const retryJoin = useCallback(() => {
    setMediaErrorKind(null);
    mutateJoin(joinArgs);
  }, [mutateJoin, joinArgs]);

  const refreshLiveKitCredential = useCallback(async () => {
    try {
      const result = await mutateJoinAsync(joinArgs);
      if (!result || !isJoinAdmitted(result) || !result.participant_token) return null;
      return { token: result.participant_token, expires_at: result.expires_at };
    } catch {
      return null;
    }
  }, [mutateJoinAsync, joinArgs]);

  const handleStartMeeting = useCallback(() => {
    start.mutate(meetingId, { onSuccess: () => retryJoin() });
  }, [start, meetingId, retryJoin]);

  useEffect(() => {
    if (!choice) return;
    if (joinOnce.current) return;
    joinOnce.current = true;
    if (isJoinAdmitted(initialJoinDecision)) return;
    retryJoin();
  }, [choice, retryJoin, initialJoinDecision]);

  const decision = join.data ?? initialJoinDecision;
  const admitted = isJoinAdmitted(decision);
  admittedRef.current = admitted;

  // LiveKit JWT refresh: proactive timer patches room.engine.token (no
  // room.connect remount). Unexpected disconnect still re-joins via retryJoin.
  useLobbyJoinRetry({
    meetingId,
    decision: decision?.decision,
    admitted,
    hasJoinError: Boolean(join.error),
    onRetry: retryJoin,
  });

  useMeetingScheduleDeadline({
    endsAt: meeting?.ends_at,
    status: meeting?.status,
    admitted,
    onLeave,
  });

  if (!choice) {
    return (
      <MeetingRoomShell testId="meeting-prejoin">
        <MeetingPreJoin
          meeting={meeting ?? undefined}
          onJoin={setChoice}
          onLeave={onLeave}
        />
      </MeetingRoomShell>
    );
  }

  // A later re-join (token refresh) must not eject an admitted session on a
  // transient error — join.error would otherwise unmount LiveKit.
  if (!admitted && (join.error || decision)) {
    return (
      <MeetingRoomShell>
        <MeetingLobby
          meetingId={meetingId}
          title={meeting?.title ?? meetingTitle}
          decision={decision?.decision}
          error={join.error}
          allowJoinRequest={guestMode ? undefined : meeting?.allow_join_request}
          canStart={canHost.allowed}
          starting={start.isPending}
          onStart={handleStartMeeting}
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
              <Skeleton key={i} className="aspect-video rounded-2xl bg-rail" />
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

  if (mediaErrorKind) {
    const replaced = mediaErrorKind === "replaced";
    return (
      <MeetingRoomShell>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-md text-pretty text-body text-foreground">
            {t(replaced ? "meetings.sessionReplaced" : "meetings.connectionFailed")}
          </p>
          <p className="max-w-md text-pretty text-caption text-muted-foreground">
            {t(replaced ? "meetings.sessionReplacedHint" : "meetings.connectionFailedHint")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!replaced ? (
              <Button
                onClick={() => {
                  credentialRefreshAttempts.current = 0;
                  retryJoin();
                }}
              >
                {t("common.retry")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onLeave}>
              {t("meetings.leave")}
            </Button>
          </div>
        </div>
      </MeetingRoomShell>
    );
  }

  return (
    <MeetingRoomShell testId="meeting-stage">
      <LiveKitRoom
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
        }}
        onError={() => {
          setMediaErrorKind((kind) => kind ?? "connection");
        }}
        onDisconnected={(reason) => {
          const kind = mediaDisconnectKind(reason);
          if (kind === "replaced") {
            setMediaErrorKind("replaced");
            return;
          }
          if (shouldLeaveOnDisconnect(reason)) {
            onLeave();
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
          retryJoin();
        }}
      >
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
        />
      </LiveKitRoom>
    </MeetingRoomShell>
  );
}
