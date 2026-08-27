"use client";
import { useCallback, useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, usePendingAuthStep } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { InvitationsView } from "@uniwork/views/workspace/invitations-view";

export default function InvitationsPage() {
  const { replace } = useNavigation();
  const { status, user } = useSession();
  const step = usePendingAuthStep();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step === "verify") replace(paths.verify());
  }, [status, step, replace]);
  const onEmpty = useCallback(() => replace(resolvePostAuthDestination([], user)), [replace, user]);
  if (status !== "authed" || step === "verify") return null;
  return (
    <InvitationsView
      onJoined={(ws) => replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}
      onEmpty={onEmpty}
    />
  );
}
