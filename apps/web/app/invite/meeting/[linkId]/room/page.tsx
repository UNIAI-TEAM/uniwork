"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { resolveInviteLink } from "@uniwork/core/api/endpoints/meetings";
import { paths } from "@uniwork/core/paths";
import { inviteSecretStorageKey } from "@uniwork/views/meetings/public-invite-view";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";
import { useNavigation } from "@uniwork/views/navigation";

/**
 * The room for someone who arrived through a public invite link and is not a
 * member of the meeting's workspace. The secret lives in sessionStorage from
 * the invite page; without it, or with a dead link, this bounces back there.
 */
export default function MeetingInviteRoomPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const { replace } = useNavigation();
  const [invite, setInvite] = useState<{
    meetingId: string;
    secret: string;
  } | null>(null);

  useEffect(() => {
    const secret = sessionStorage.getItem(inviteSecretStorageKey(linkId)) ?? "";
    if (!secret) {
      replace(paths.meetingInvite(linkId));
      return;
    }
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!res?.meeting_id || res.expired) replace(paths.meetingInvite(linkId));
      else setInvite({ meetingId: res.meeting_id, secret });
    }, () => replace(paths.meetingInvite(linkId)));
  }, [linkId, replace]);

  if (!invite) return null;
  return (
    <MeetingRoomView
      meetingId={invite.meetingId}
      invite={{ linkId, secret: invite.secret }}
      onLeave={() => replace(paths.meetingInvite(linkId))}
    />
  );
}
