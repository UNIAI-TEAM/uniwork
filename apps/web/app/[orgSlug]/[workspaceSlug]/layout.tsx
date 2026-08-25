"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { DashboardLayout } from "@uniwork/views/layout/dashboard-layout";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { WelcomeAfterOnboarding } from "@uniwork/views/workspace/welcome-after-onboarding";

/** Route wiring only: URL params in, the shared dashboard shell out. */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  return (
    <DashboardLayout orgSlug={orgSlug} wsSlug={workspaceSlug} extra={<Welcome />}>
      {children}
    </DashboardLayout>
  );
}

function Welcome() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  return (
    <WelcomeAfterOnboarding
      workspace={workspace}
      onOpenTask={(id) => push(paths.workspace(workspace.organization_slug, workspace.slug).task(id))}
    />
  );
}
