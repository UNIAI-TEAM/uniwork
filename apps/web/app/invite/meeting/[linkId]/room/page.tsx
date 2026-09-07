"use client";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getGuestSession } from "@uniwork/core/api/guest-session";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import {
  inviteStorageKey,
  readCachedJoinDecision,
  readGuestSession,
  readInviteJoinBody,
} from "@uniwork/views/meetings/meeting-invite-session";

// The room view carries the LiveKit SDK (~130 KB gzip). Turbopack groups it
// with this segment, so importing it eagerly puts the SDK in the entry chunk of
// the public invite page too, where nobody has joined a call yet. Behind lazy()
// it becomes an async chunk that neither entry lists
// (scripts/bundle-budget.mjs).
const MeetingRoomView = lazy(() =>
  import("@uniwork/views/meetings/room-view").then((m) => ({ default: m.MeetingRoomView })),
);

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
  const authStatus = useAuthStore((s) => s.status);
  const [session, setSession] = useState<InviteRoomSession>(EMPTY_INVITE_ROOM_SESSION);

  useEffect(() => {
    setSession(loadInviteRoomSession(linkId));
  }, [linkId]);

  const isGuest = authStatus === "anon";

  const ready = useMemo(() => {
    if (!session.hydrated || authStatus === "loading") return false;
    if (session.meetingId === "" || !session.joinBody?.secret) return false;
    if (isGuest) return Boolean(getGuestSession());
    return authStatus === "authed";
  }, [session.hydrated, session.meetingId, session.joinBody?.secret, authStatus, isGuest]);

  useEffect(() => {
    if (!session.hydrated || authStatus === "loading") return;
    if (!ready) {
      nav.replace(`${paths.meetingInvite(linkId)}?reason=missing_session`);
    }
  }, [session.hydrated, authStatus, ready, nav, linkId]);

  if (!ready || !session.joinBody?.secret) {
    return null;
  }

  const inviteSecret = session.joinBody.secret;

  return (
    <MeetingLobbyWSProvider meetingId={session.meetingId}>
      <Suspense fallback={null}>
        <MeetingRoomView
          meetingId={session.meetingId}
          guestMode={isGuest}
          joinBody={session.joinBody}
          invite={isGuest ? { linkId, secret: inviteSecret } : undefined}
          meetingTitle={session.meetingTitle}
          initialJoinDecision={session.initialJoinDecision}
          onLeave={() => nav.push(`${paths.meetingInvite(linkId)}?reason=left_room`)}
        />
      </Suspense>
    </MeetingLobbyWSProvider>
  );
}
