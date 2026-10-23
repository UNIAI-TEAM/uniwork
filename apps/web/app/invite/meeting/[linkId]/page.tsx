"use client";
import { useLayoutEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MeetingInvitePageSkeleton } from "@uniwork/views/meetings/meeting-page-skeletons";
import { MeetingPublicInviteView } from "@uniwork/views/meetings/public-invite-view";
import { inviteStorageKey, readGuestSession } from "@uniwork/views/meetings/meeting-invite-session";

/** `#secret=…` (possibly among other fragment params), or "" when absent. */
function secretFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("secret") ?? "";
}

export default function MeetingInvitePage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [secret, setSecret] = useState<string | null>(null);
  useLayoutEffect(() => {
    readGuestSession(linkId);
    const fromHash = secretFromHash(window.location.hash);
    if (fromHash) {
      sessionStorage.setItem(inviteStorageKey(linkId, "secret"), fromHash);
      // The secret now lives in sessionStorage; keep it out of the address
      // bar, screenshots and anything copied from there.
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}`);
      setSecret(fromHash);
      return;
    }
    setSecret(sessionStorage.getItem(inviteStorageKey(linkId, "secret")) ?? "");
  }, [linkId]);
  if (secret === null) return <MeetingInvitePageSkeleton />;
  return <MeetingPublicInviteView linkId={linkId} secret={secret} />;
}
