"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MeetingPublicInviteView } from "@uniwork/views/meetings/public-invite-view";
import { inviteStorageKey } from "@uniwork/views/meetings/meeting-invite-session";

export default function MeetingInvitePage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#secret=/, "");
    if (fromHash) {
      sessionStorage.setItem(inviteStorageKey(linkId, "secret"), fromHash);
      setSecret(fromHash);
      return;
    }
    setSecret(sessionStorage.getItem(inviteStorageKey(linkId, "secret")) ?? "");
  }, [linkId]);
  if (secret === null) return null;
  return <MeetingPublicInviteView linkId={linkId} secret={secret} />;
}
