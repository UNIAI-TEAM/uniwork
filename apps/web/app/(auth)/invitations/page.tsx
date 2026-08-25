"use client";
import { useCallback, useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, useHasOnboarded } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { InvitationsView } from "@uniwork/views/workspace/invitations-view";

export default function InvitationsPage() {
  const { replace } = useNavigation();
  const { status } = useSession();
  const hasOnboarded = useHasOnboarded();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
  }, [status, replace]);
  const onEmpty = useCallback(() => replace(resolvePostAuthDestination([], hasOnboarded)), [replace, hasOnboarded]);
  if (status !== "authed") return null;
  return (
    <InvitationsView
      onJoined={(ws) => replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}
      onEmpty={onEmpty}
    />
  );
}
