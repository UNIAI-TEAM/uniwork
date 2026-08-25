"use client";
import { createContext, useContext, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useSession } from "@uniwork/core/auth";
import { useWorkspace } from "@uniwork/core/workspaces";
import type { User, Workspace } from "@uniwork/core/types";
import { AppShell } from "@uniwork/views/layout/app-shell";

const WorkspaceContext = createContext<{ workspace: Workspace; user: User } | null>(null);

export function useCurrentWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useCurrentWorkspace outside workspace layout");
  return ctx;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { user, status } = useSession();
  const { data: workspace, error } = useWorkspace(status === "authed" ? workspaceSlug : "");

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    if (error) router.replace("/workspaces");
  }, [status, error, router]);

  if (status !== "authed" || !workspace || !user) return null;

  const active = pathname.split("/")[2] ?? "tasks";
  return (
    <WorkspaceContext.Provider value={{ workspace, user }}>
      <AppShell workspace={workspace} user={user} active={active}>
        {children}
      </AppShell>
    </WorkspaceContext.Provider>
  );
}
