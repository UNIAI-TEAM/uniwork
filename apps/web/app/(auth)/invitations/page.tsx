"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, useHasOnboarded } from "@uniwork/core/paths";
import { InvitationsView } from "@uniwork/views/workspace/invitations-view";

export default function InvitationsPage() {
  const router = useRouter();
  const { status } = useSession();
  const hasOnboarded = useHasOnboarded();
  useEffect(() => {
    if (status === "anon") router.replace(paths.login());
  }, [status, router]);
  const onEmpty = useCallback(() => router.replace(resolvePostAuthDestination([], hasOnboarded)), [router, hasOnboarded]);
  if (status !== "authed") return null;
  return (
    <InvitationsView
      onJoined={(ws) => router.replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}
      onEmpty={onEmpty}
    />
  );
}
