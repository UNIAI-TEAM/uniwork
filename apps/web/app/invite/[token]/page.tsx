"use client";
import { useParams, useRouter } from "next/navigation";
import { AcceptInviteView } from "@uniwork/views/workspace/accept-invite-view";

export default function InvitePage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  return (
    <AcceptInviteView
      token={token}
      onAccepted={(slug) => router.replace(`/${slug}/tasks`)}
      onAnon={() => router.replace("/login")}
    />
  );
}
