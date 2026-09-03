"use client";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { isJoinAdmitted, useJoinMeeting, useMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingConference } from "./meeting-conference";
import { MeetingLobby } from "./meeting-lobby";
import {
  mediaDisconnectKind,
  shouldLeaveOnDisconnect,
  shouldRefreshCredentialOnDisconnect,
  type MediaDisconnectKind,
} from "./room-connection";
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
      className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell"
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
  onLeave,
}: {
  meetingId: string;
  workspaceId?: string;
  joinBody?: JoinMeetingBody;
  /** Public invite flow: skip workspace-scoped APIs that require a member session. */
  guestMode?: boolean;
  meetingTitle?: string;
  initialJoinDecision?: JoinDecision;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const join = useJoinMeeting();
  const { data: meeting } = useMeeting(meetingId, { enabled: !guestMode });
  const resolvedWorkspaceId = guestMode ? (workspaceId ?? "") : (workspaceId ?? meeting?.workspace_id ?? "");
  const start = useStartMeeting(resolvedWorkspaceId);
  const { canHost } = useMeetingPermissions(guestMode ? null : (meeting ?? null), resolvedWorkspaceId);
  useWorkspaceEvents(guestMode ? "" : resolvedWorkspaceId);
  const joinOnce = useRef(false);
  const admittedRef = useRef(false);
  const credentialRefreshAttempts = useRef(0);
  const [mediaErrorKind, setMediaErrorKind] = useState<MediaDisconnectKind | null>(null);
  const mutateJoin = join.mutate;
  const joinArgs = useMemo(
    () => (joinBody ? { meetingId, ...joinBody } : { meetingId }),
    [meetingId, joinBody],
  );

  const retryJoin = useCallback(() => {
    setMediaErrorKind(null);
    mutateJoin(joinArgs);
  }, [mutateJoin, joinArgs]);

  const handleStartMeeting = useCallback(() => {
    start.mutate(meetingId, { onSuccess: () => retryJoin() });
  }, [start, meetingId, retryJoin]);

  useEffect(() => {
    if (joinOnce.current) return;
    joinOnce.current = true;
    if (isJoinAdmitted(initialJoinDecision)) return;
    retryJoin();
  }, [retryJoin, initialJoinDecision]);

  const decision = join.data ?? initialJoinDecision;
  const admitted = isJoinAdmitted(decision);
  admittedRef.current = admitted;

  useLobbyJoinRetry({
    meetingId,
    decision: decision?.decision,
    admitted,
    hasJoinError: Boolean(join.error),
    onRetry: retryJoin,
  });

  // A later re-join (token refresh) must not eject an admitted session on a
  // transient error — join.error would otherwise unmount LiveKit.
  if (!admitted && (join.error || decision)) {
    return (
      <MeetingRoomShell>
        <MeetingLobby
          meetingId={meetingId}
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-body text-muted-foreground">
            {join.isPending ? t("meetings.joining") : t("common.loading")}
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
        video={false}
        audio={false}
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
        <MeetingConference
          meeting={meeting ?? undefined}
          meetingTitle={meetingTitle}
          workspaceId={guestMode ? undefined : workspaceId}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </MeetingRoomShell>
  );
}
