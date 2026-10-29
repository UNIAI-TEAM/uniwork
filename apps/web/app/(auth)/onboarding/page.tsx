"use client";
import { useEffect, useRef } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import {
  paths,
  resolvePostAuthDestination,
  sanitizeNextUrl,
  useHasOnboarded,
  usePendingAuthStep,
} from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { useNavigation } from "@uniwork/views/navigation";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

export default function OnboardingPage() {
  const { push, replace, searchParams } = useNavigation();
  const { status, user } = useSession();
  // Where the person was headed before the gates (spec §4.2): onboarding
  // carries it and goes on to it once the account is set up.
  const next = sanitizeNextUrl(searchParams.get("next"));
  const hasOnboarded = useHasOnboarded();
  const step = usePendingAuthStep();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  // An onboarded account that left or closed its organization belongs on
  // /get-started (ADR 0032 D12); the resolver needs the list to tell.
  const { data: organizations, isFetched: orgsFetched } = useOrganizations(status === "authed" && hasOnboarded);
  // Latch: while onComplete is pushing, the guard (which just saw onboarded_at
  // flip) must not replace over it.
  const completing = useRef(false);

  useEffect(() => {
    if (status === "anon") replace(paths.login({ next }));
    if (status === "authed" && step === "verify") replace(paths.verify({ next }));
    if (status === "authed" && hasOnboarded && isFetched && orgsFetched && !completing.current) {
      replace(next ?? resolvePostAuthDestination(workspaces, user, organizations));
    }
  }, [status, step, user, hasOnboarded, isFetched, orgsFetched, workspaces, organizations, next, replace]);

  if (status !== "authed" || step === "verify" || (hasOnboarded && !completing.current)) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <OnboardingFlow
        onBeginComplete={() => {
          completing.current = true;
        }}
        onCompleteFailed={() => {
          completing.current = false;
        }}
        onComplete={(ws) => {
          // `next` first: the invitation or consent that started the sign-up.
          // Otherwise `/` is the public landing page now; an onboarding that
          // produced no workspace belongs on the picker, not on marketing.
          push(next ?? (ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.workspaces()));
        }}
      />
    </div>
  );
}
