"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, useHasOnboarded } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

export default function OnboardingPage() {
  const router = useRouter();
  const { status } = useSession();
  const hasOnboarded = useHasOnboarded();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  // Latch: khi onComplete đang push, guard (thấy onboarded_at vừa set) không được replace đè.
  const completing = useRef(false);

  useEffect(() => {
    if (status === "anon") router.replace(paths.login());
    if (status === "authed" && hasOnboarded && isFetched && !completing.current) {
      router.replace(resolvePostAuthDestination(workspaces, true));
    }
  }, [status, hasOnboarded, isFetched, workspaces, router]);

  if (status !== "authed" || (hasOnboarded && !completing.current)) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-canvas">
      <OnboardingFlow
        onComplete={(ws) => {
          completing.current = true;
          router.push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.root());
        }}
      />
    </div>
  );
}
