"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MeetingPublicInviteView } from "@uniwork/views/meetings/public-invite-view";

export default function MeetingInvitePage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    setSecret(window.location.hash.replace(/^#secret=/, ""));
  }, []);
  if (secret === null) return null;
  return <MeetingPublicInviteView linkId={linkId} secret={secret} />;
}
