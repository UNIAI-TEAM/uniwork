"use client";
import { createContext, useContext } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { WSProvider } from "@uniwork/core/realtime";
import type { User, Workspace } from "@uniwork/core/types";
import { AppShell } from "@uniwork/views/layout/app-shell";
import { DashboardGuard } from "@uniwork/views/layout/dashboard-guard";
import { useNavigation } from "@uniwork/views/navigation";
import { WelcomeAfterOnboarding } from "@uniwork/views/workspace/welcome-after-onboarding";

const WorkspaceContext = createContext<{ workspace: Workspace; user: User } | null>(null);

export function useCurrentWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useCurrentWorkspace outside workspace layout");
  return ctx;
}

/**
 * Route wiring only. The auth → onboarding → workspace gate and its
 * redirects live in DashboardGuard (packages/views), which goes through the
 * navigation adapter; this file reads the URL params and composes the chrome.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { pathname, push } = useNavigation();
  const active = pathname.split("/")[3] ?? "tasks";

  return (
    <DashboardGuard orgSlug={orgSlug} wsSlug={workspaceSlug}>
      {({ user, workspace }) => (
        <WorkspaceContext.Provider value={{ workspace, user }}>
          <WSProvider workspaceSlug={`${orgSlug}/${workspaceSlug}`}>
            <AppShell workspace={workspace} user={user} active={active}>
              {children}
              <WelcomeAfterOnboarding
                workspace={workspace}
                onOpenTask={(id) => push(paths.workspace(orgSlug, workspaceSlug).task(id))}
              />
            </AppShell>
          </WSProvider>
        </WorkspaceContext.Provider>
      )}
    </DashboardGuard>
  );
}
