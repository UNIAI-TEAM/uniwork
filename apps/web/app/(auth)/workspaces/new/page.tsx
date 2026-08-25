"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

/** Cùng flow onboarding ở chế độ tạo workspace mới cho user đã onboard. */
export default function NewWorkspacePage() {
  const router = useRouter();
  const { status } = useSession();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  useEffect(() => {
    if (status === "anon") router.replace(paths.login());
  }, [status, router]);
  if (status !== "authed" || !isFetched) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-canvas">
      <OnboardingFlow
        mode="new_workspace"
        // Chỉ được huỷ khi đã có nơi để quay về; 0 workspace thì phải hoàn tất.
        onCancel={workspaces.length > 0 ? () => router.push(resolvePostAuthDestination(workspaces, true)) : undefined}
        onComplete={(ws) => router.push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.root())}
      />
    </div>
  );
}
