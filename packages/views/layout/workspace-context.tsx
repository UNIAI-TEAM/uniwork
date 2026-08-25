"use client";

import { createContext, use, type ReactNode } from "react";
import type { User, Workspace } from "@uniwork/core/types";

interface WorkspaceContextValue {
  workspace: Workspace;
  user: User;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * The resolved workspace and session user for everything under
 * /{orgSlug}/{workspaceSlug}. Provided by DashboardLayout once the guard has
 * let the user through, so consumers never see a null workspace.
 *
 * Platform plumbing only — server data stays in React Query. Hooks that need
 * a workspace id should still accept `wsId` explicitly; this is for screens
 * that are, by construction, always inside a workspace.
 */
export function WorkspaceProvider({
  workspace,
  user,
  children,
}: WorkspaceContextValue & { children: ReactNode }) {
  return <WorkspaceContext.Provider value={{ workspace, user }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = use(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function useWorkspaceId(): string {
  return useWorkspace().workspace.id;
}
