"use client";
import { createContext, useContext, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { useWorkspace } from "@uniwork/core/workspaces";
import { AppShell } from "@uniwork/views/layout/app-shell";
import { WelcomeAfterOnboarding } from "@uniwork/views/workspace/welcome-after-onboarding";

const WorkspaceContext = createContext<{ workspace: Workspace; user: User } | null>(null);

export function useCurrentWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useCurrentWorkspace outside workspace layout");
  return ctx;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { user, status } = useSession();
  const { data: workspace, error } = useWorkspace(status === "authed" ? orgSlug : "", workspaceSlug);

  useEffect(() => {
    if (status === "anon") router.replace(`${paths.login()}?next=${encodeURIComponent(pathname)}`);
    // Guard gương với /onboarding: onboarded_at là nguồn sự thật, không phải số workspace.
    if (user && user.onboarded_at == null) router.replace(paths.onboarding());
    if (error) router.replace(paths.workspaces());
  }, [status, user, error, router, pathname]);

  if (status !== "authed" || !workspace || !user || user.onboarded_at == null) return null;

  const active = pathname.split("/")[3] ?? "tasks";
  return (
    <WorkspaceContext.Provider value={{ workspace, user }}>
      <AppShell workspace={workspace} user={user} active={active}>
        {children}
        <WelcomeAfterOnboarding
          workspace={workspace}
          onOpenTask={(id) => router.push(paths.workspace(orgSlug, workspaceSlug).task(id))}
        />
      </AppShell>
    </WorkspaceContext.Provider>
  );
}
