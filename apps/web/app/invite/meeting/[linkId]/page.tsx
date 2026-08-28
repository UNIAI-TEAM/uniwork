"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MeetingPublicInviteView } from "@uniwork/views/meetings/public-invite-view";

function secretKey(linkId: string): string {
  return `uw.meeting-invite.${linkId}`;
}

export default function MeetingInvitePage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#secret=/, "");
    if (fromHash) {
      sessionStorage.setItem(secretKey(linkId), fromHash);
      setSecret(fromHash);
      return;
    }
    setSecret(sessionStorage.getItem(secretKey(linkId)) ?? "");
  }, [linkId]);
  if (secret === null) return null;
  return <MeetingPublicInviteView linkId={linkId} secret={secret} />;
}
