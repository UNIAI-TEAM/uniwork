"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { useNavigation } from "@uniwork/views/navigation";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

/** The onboarding flow in "new workspace" mode for a user who has already onboarded. */
export default function NewWorkspacePage() {
  const { push, replace } = useNavigation();
  const { status } = useSession();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
  }, [status, replace]);
  if (status !== "authed" || !isFetched) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <OnboardingFlow
        mode="new_workspace"
        // Cancelling needs somewhere to return to; with no workspace the flow must complete.
        onCancel={workspaces.length > 0 ? () => push(resolvePostAuthDestination(workspaces, true)) : undefined}
        onComplete={(ws) => push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.root())}
      />
    </div>
  );
}
