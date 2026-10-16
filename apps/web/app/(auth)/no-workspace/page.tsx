"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { authStepPath, paths, usePendingAuthStep } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { NoWorkspaceView } from "@uniwork/views/onboarding/no-workspace-view";

/**
 * Where a member of an organization with no workspace to open lands
 * (UNI-1472, UNI-1582). The gates ahead of it are the usual ones: signed in,
 * email verified, onboarded.
 */
export default function NoWorkspacePage() {
  const { replace } = useNavigation();
  const { status } = useSession();
  const step = usePendingAuthStep();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step) replace(authStepPath(step));
  }, [status, step, replace]);
  // The view's own loading frame while the gates resolve: never a blank page.
  return <NoWorkspaceView pending={status !== "authed" || !!step} />;
}
