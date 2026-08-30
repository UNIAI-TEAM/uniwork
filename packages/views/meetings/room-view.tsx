"use client";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  isJoinAdmitted,
  useJoinMeeting,
  useMeeting,
} from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { MeetingConference } from "./meeting-conference";
import { MeetingLobby } from "./meeting-lobby";
import { MeetingPreJoin, type PreJoinChoice } from "./meeting-prejoin";
import {
  shouldLeaveOnDisconnect,
  tokenRefreshDelayMs,
} from "./room-connection";

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
  invite,
  onLeave,
}: {
  meetingId: string;
  workspaceId?: string;
  /** Public-link credentials for someone outside the workspace; every join carries them. */
  invite?: { linkId: string; secret: string };
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const join = useJoinMeeting();
  const inviteLinkId = invite?.linkId;
  const inviteSecret = invite?.secret;
  const { data: meeting } = useMeeting(meetingId);
  useWorkspaceEvents(workspaceId ?? meeting?.workspace_id ?? "");
  const [choice, setChoice] = useState<PreJoinChoice | null>(null);
  const mutateJoin = join.mutate;

  // Admission is requested only after the user leaves the pre-join screen.
  useEffect(() => {
    if (choice)
      mutateJoin({
        meetingId,
        invite_link_id: inviteLinkId,
        secret: inviteSecret,
      });
  }, [choice, mutateJoin, meetingId, inviteLinkId, inviteSecret]);

  const expiresAt = join.data?.expires_at;
  const admittedNow = isJoinAdmitted(join.data);

  useEffect(() => {
    if (!admittedNow) return;
    const delay = tokenRefreshDelayMs(expiresAt);
    if (delay == null) return;
    const id = window.setTimeout(
      () =>
        mutateJoin({
          meetingId,
          invite_link_id: inviteLinkId,
          secret: inviteSecret,
        }),
      delay,
    );
    return () => window.clearTimeout(id);
  }, [
    admittedNow,
    expiresAt,
    meetingId,
    mutateJoin,
    inviteLinkId,
    inviteSecret,
  ]);

  useEffect(() => {
    if (admittedNow || join.error) return;
    if (!join.data) return;
    const id = window.setInterval(
      () =>
        mutateJoin({
          meetingId,
          invite_link_id: inviteLinkId,
          secret: inviteSecret,
        }),
      4000,
    );
    return () => window.clearInterval(id);
  }, [
    admittedNow,
    join.data,
    join.error,
    meetingId,
    mutateJoin,
    inviteLinkId,
    inviteSecret,
  ]);

  const decision = join.data;
  const admitted = isJoinAdmitted(decision);

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
          title={meeting?.title}
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
        <div
          role="status"
          className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <div aria-hidden className="grid w-full max-w-md grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-video rounded-2xl bg-rail" />
            ))}
          </div>
          {meeting?.title ? (
            <p className="max-w-md truncate text-title-sm font-semibold text-foreground">
              {meeting.title}
            </p>
          ) : null}
          <p className="text-body text-muted-foreground">
            {t("meetings.connecting")}
          </p>
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
