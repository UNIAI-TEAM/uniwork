"use client";

import { useEffect } from "react";
import { errorCode } from "@uniwork/core/api";
import { useSession } from "@uniwork/core/auth";
import { authStepPath, paths, pendingAuthStep } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { useWorkspace } from "@uniwork/core/workspaces";
import { useNavigation } from "../navigation";
import { ORGANIZATION_SUSPENDED } from "./use-organization-suspended";

/**
 * Auth + workspace gate for every /{org}/{ws}/* screen.
 *
 *  - session loading            → wait
 *  - anonymous                  → /login?next=<current path>
 *  - signed in, email unverified → /verify
 *  - signed in, not onboarded   → /onboarding (onboarded_at is the single
 *                                 source of truth, never the workspace count)
 *    (both decided by pendingAuthStep, which owns the order)
 *  - organization suspended     → stay; the shell shows the notice
 *  - URL pair does not resolve  → /workspaces
 *
 * Runs through the navigation adapter, so the same guard serves any host.
 */
export function useDashboardGuard(
  orgSlug: string,
  wsSlug: string,
): { user: User | null; workspace: Workspace | null; isLoading: boolean; suspended: boolean } {
  const { pathname, replace } = useNavigation();
  const { user, status } = useSession();
  const {
    data: workspace,
    error,
    isLoading: workspaceLoading,
  } = useWorkspace(status === "authed" ? orgSlug : "", wsSlug);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anon") {
      replace(`${paths.login()}?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const step = pendingAuthStep(user);
    if (step) {
      replace(authStepPath(step));
      return;
    }
    if (errorCode(error) === ORGANIZATION_SUSPENDED) return;
    // A drifted response resolves to null rather than an error; both mean
    // "this URL is not a workspace you can see".
    if (error || (!workspaceLoading && workspace === null)) replace(paths.workspaces());
  }, [status, user, error, workspace, workspaceLoading, replace, pathname]);

  const ready = status === "authed" && !!user && pendingAuthStep(user) === null && !!workspace;
  return {
    user: ready ? user : null,
    workspace: ready ? workspace : null,
    isLoading: status === "loading" || workspaceLoading,
    suspended: errorCode(error) === ORGANIZATION_SUSPENDED,
  };
}
