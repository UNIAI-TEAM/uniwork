"use client";

import { useParams } from "next/navigation";
import { JoinMembershipInviteView } from "@uniwork/views/workspace/join-membership-invite-view";

export default function JoinMembershipInvitePage() {
  const { linkId } = useParams<{ linkId: string }>();
  return <JoinMembershipInviteView linkId={linkId} />;
}
