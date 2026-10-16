"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths, resolvePostAuthDestination, workspacelessDestination } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { useNavigation } from "@uniwork/views/navigation";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

/** The onboarding flow in "new workspace" mode for a user who has already onboarded. */
export default function NewWorkspacePage() {
  const { push, replace } = useNavigation();
  const { status, user } = useSession();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  // Already read by the organization step; here it lets Cancel skip the
  // workspaces of an organization that was closed (ADR 0032).
  const { data: organizations, isFetched: orgsFetched } = useOrganizations(status === "authed");
  // A member with no workspace waits to be given one (UNI-1472): the create
  // flow, which opens on the organization step, is not their way in. With a
  // workspace already, creating another stays theirs to choose.
  const waitForGrant =
    isFetched && orgsFetched && workspaces.length === 0 && workspacelessDestination(organizations) === paths.noWorkspace();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (waitForGrant) replace(paths.noWorkspace());
  }, [status, waitForGrant, replace]);
  if (status !== "authed" || !isFetched || waitForGrant) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <OnboardingFlow
        mode="new_workspace"
        // Cancelling needs somewhere to return to; with no workspace the flow must complete.
        onCancel={workspaces.length > 0 ? () => push(resolvePostAuthDestination(workspaces, user, organizations)) : undefined}
        // `/` is the public landing page now, so a completion that produced no
        // workspace goes to the picker rather than back out to marketing.
        onComplete={(ws) => push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.workspaces())}
      />
    </div>
  );
}
