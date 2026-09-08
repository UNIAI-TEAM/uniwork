"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { AcceptInviteView } from "@uniwork/views/workspace/accept-invite-view";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { replace } = useNavigation();
  return (
    <AcceptInviteView
      token={token}
      onAccepted={(ws) =>
        replace(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.workspaces())
      }
      onAnon={() => replace(`${paths.login()}?next=${encodeURIComponent(paths.invite(token))}`)}
    />
  );
}
