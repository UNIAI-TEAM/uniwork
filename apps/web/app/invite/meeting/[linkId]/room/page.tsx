"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";
import {
  inviteStorageKey,
  readCachedJoinDecision,
  readInviteJoinBody,
} from "@uniwork/views/meetings/meeting-invite-session";

function meetingInviteLoginUrl(linkId: string): string {
  return `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}&reason=meeting_invite`;
}

export default function MeetingInviteRoomPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const nav = useNavigation();
  const authStatus = useAuthStore((s) => s.status);
  const [meetingId, setMeetingId] = useState("");
  const [joinBody, setJoinBody] = useState<ReturnType<typeof readInviteJoinBody>>();
  const [initialJoinDecision, setInitialJoinDecision] = useState<JoinDecision | undefined>();
  const [meetingTitle, setMeetingTitle] = useState("");

  useEffect(() => {
    const mid = sessionStorage.getItem(inviteStorageKey(linkId, "meetingId")) ?? "";
    setMeetingId(mid);
    setJoinBody(readInviteJoinBody(linkId));
    setInitialJoinDecision(readCachedJoinDecision(linkId));
    setMeetingTitle(sessionStorage.getItem(inviteStorageKey(linkId, "title")) ?? "");
  }, [linkId]);

  const ready = useMemo(() => meetingId !== "" && Boolean(joinBody?.secret), [meetingId, joinBody?.secret]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "anon") {
      nav.replace(meetingInviteLoginUrl(linkId));
      return;
    }
    if (!ready) {
      nav.replace(`${paths.meetingInvite(linkId)}?reason=login_required`);
    }
  }, [authStatus, ready, nav, linkId]);

  if (authStatus !== "authed" || !ready) {
    return null;
  }

  return (
    <MeetingLobbyWSProvider meetingId={meetingId}>
      <MeetingRoomView
        meetingId={meetingId}
        joinBody={joinBody}
        meetingTitle={meetingTitle}
        initialJoinDecision={initialJoinDecision}
        onLeave={() => nav.push(`${paths.meetingInvite(linkId)}?reason=left_room`)}
      />
    </MeetingLobbyWSProvider>
  );
}
