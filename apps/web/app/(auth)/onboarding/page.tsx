"use client";
import { useEffect, useRef } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, useHasOnboarded } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { useNavigation } from "@uniwork/views/navigation";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

export default function OnboardingPage() {
  const { push, replace } = useNavigation();
  const { status } = useSession();
  const hasOnboarded = useHasOnboarded();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  // Latch: while onComplete is pushing, the guard (which just saw onboarded_at
  // flip) must not replace over it.
  const completing = useRef(false);

  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && hasOnboarded && isFetched && !completing.current) {
      replace(resolvePostAuthDestination(workspaces, true));
    }
  }, [status, hasOnboarded, isFetched, workspaces, replace]);

  if (status !== "authed" || (hasOnboarded && !completing.current)) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <OnboardingFlow
        onComplete={(ws) => {
          completing.current = true;
          push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.root());
        }}
      />
    </div>
  );
}
