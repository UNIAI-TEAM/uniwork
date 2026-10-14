"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { authStepPath, paths, usePendingAuthStep } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { NoOrganizationView } from "@uniwork/views/onboarding/no-organization-view";

/**
 * Where an onboarded person with no organization lands (ADR 0032 D12). The
 * gates ahead of it are the usual ones: signed in, email verified, onboarded —
 * someone still onboarding creates their organization in that flow instead.
 */
export default function GetStartedPage() {
  const { replace } = useNavigation();
  const { status } = useSession();
  const step = usePendingAuthStep();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step) replace(authStepPath(step));
  }, [status, step, replace]);
  // The view's own loading frame while the gates resolve: never a blank page.
  return <NoOrganizationView pending={status !== "authed" || !!step} />;
}
