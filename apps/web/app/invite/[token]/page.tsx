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
      // No workspace to land in: the picker hands over to /no-workspace for a
      // member, the create flow only for an owner or admin (UNI-1472).
      onAccepted={(ws) =>
        replace(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.workspaces())
      }
      onAnon={() => replace(`${paths.login()}?next=${encodeURIComponent(paths.invite(token))}`)}
    />
  );
}
