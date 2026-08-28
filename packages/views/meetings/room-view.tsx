"use client";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isJoinAdmitted, useJoinMeeting, useMeeting } from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingConference } from "./meeting-conference";
import { MeetingLobby } from "./meeting-lobby";
import { shouldLeaveOnDisconnect, tokenRefreshDelayMs } from "./room-connection";

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
  onLeave,
}: {
  meetingId: string;
  workspaceId?: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const join = useJoinMeeting();
  const { data: meeting } = useMeeting(meetingId);
  useWorkspaceEvents(workspaceId ?? meeting?.workspace_id ?? "");
  const joinOnce = useRef(false);
  const mutateJoin = join.mutate;

  useEffect(() => {
    if (joinOnce.current) return;
    joinOnce.current = true;
    mutateJoin({ meetingId });
  }, [mutateJoin, meetingId]);

  const expiresAt = join.data?.expires_at;
  const admittedNow = isJoinAdmitted(join.data);

  useEffect(() => {
    if (!admittedNow) return;
    const delay = tokenRefreshDelayMs(expiresAt);
    if (delay == null) return;
    const id = window.setTimeout(() => mutateJoin({ meetingId }), delay);
    return () => window.clearTimeout(id);
  }, [admittedNow, expiresAt, meetingId, mutateJoin]);

  useEffect(() => {
    if (admittedNow || join.error) return;
    if (!join.data) return;
    const id = window.setInterval(() => mutateJoin({ meetingId }), 4000);
    return () => window.clearInterval(id);
  }, [admittedNow, join.data, join.error, meetingId, mutateJoin]);

  const decision = join.data;
  const admitted = isJoinAdmitted(decision);

  // A later re-join (token refresh) must not eject an admitted session on a
  // transient error — join.error would otherwise unmount LiveKit.
  if (!admitted && (join.error || decision)) {
    return (
      <MeetingRoomShell>
        <MeetingLobby
          meetingId={meetingId}
          decision={decision?.decision}
          error={join.error}
          allowJoinRequest={meeting?.allow_join_request}
          onLeave={onLeave}
        />
      </MeetingRoomShell>
    );
  }

  if (!admitted || !decision?.server_url || !decision.participant_token) {
    return (
      <MeetingRoomShell>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-body text-muted-foreground">{t("common.loading")}</p>
          <Button variant="outline" onClick={onLeave}>
            {t("meetings.leave")}
          </Button>
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
        onDisconnected={(reason) => {
          if (shouldLeaveOnDisconnect(reason)) onLeave();
        }}
      >
        <MeetingConference
          meeting={meeting ?? undefined}
          workspaceId={workspaceId}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </MeetingRoomShell>
  );
}
