"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { AcceptInviteView } from "@uniwork/views/workspace/accept-invite-view";

export default function InvitePage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  return (
    <AcceptInviteView
      token={token}
      onAccepted={(ws) => router.replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}
      onAnon={() => router.replace(`${paths.login()}?next=${encodeURIComponent(paths.invite(token))}`)}
    />
  );
}
