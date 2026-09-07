"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getGuestSession } from "@uniwork/core/api/guest-session";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";
import {
  inviteStorageKey,
  readCachedJoinDecision,
  readGuestSession,
  readInviteJoinBody,
} from "@uniwork/views/meetings/meeting-invite-session";

type InviteRoomSession = {
  hydrated: boolean;
  meetingId: string;
  joinBody: ReturnType<typeof readInviteJoinBody>;
  initialJoinDecision: JoinDecision | undefined;
  meetingTitle: string;
};

const EMPTY_INVITE_ROOM_SESSION: InviteRoomSession = {
  hydrated: false,
  meetingId: "",
  joinBody: undefined,
  initialJoinDecision: undefined,
  meetingTitle: "",
};

function loadInviteRoomSession(linkId: string): InviteRoomSession {
  readGuestSession(linkId);
  return {
    hydrated: true,
    meetingId: sessionStorage.getItem(inviteStorageKey(linkId, "meetingId")) ?? "",
    joinBody: readInviteJoinBody(linkId),
    initialJoinDecision: readCachedJoinDecision(linkId),
    meetingTitle: sessionStorage.getItem(inviteStorageKey(linkId, "title")) ?? "",
  };
}

export default function MeetingInviteRoomPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const nav = useNavigation();
  const [session, setSession] = useState<InviteRoomSession>(EMPTY_INVITE_ROOM_SESSION);

  useEffect(() => {
    setSession(loadInviteRoomSession(linkId));
  }, [linkId]);

  const ready = useMemo(
    () => session.meetingId !== "" && Boolean(session.joinBody?.secret) && Boolean(getGuestSession()),
    [session.meetingId, session.joinBody?.secret],
  );

  useEffect(() => {
    if (!session.hydrated) return;
    if (!ready) {
      nav.replace(`${paths.meetingInvite(linkId)}?reason=missing_session`);
    }
  }, [session.hydrated, ready, nav, linkId]);

  if (!session.hydrated || !ready || !session.joinBody?.secret) {
    return null;
  }

  return (
    <MeetingLobbyWSProvider meetingId={session.meetingId}>
      <MeetingRoomView
        meetingId={session.meetingId}
        guestMode
        joinBody={session.joinBody}
        invite={{ linkId, secret: session.joinBody.secret }}
        meetingTitle={session.meetingTitle}
        initialJoinDecision={session.initialJoinDecision}
        onLeave={() => nav.push(`${paths.meetingInvite(linkId)}?reason=left_room`)}
      />
    </MeetingLobbyWSProvider>
  );
}
