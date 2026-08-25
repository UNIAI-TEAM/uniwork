"use client";

import type { ReactNode } from "react";
import type { User, Workspace } from "@uniwork/core/types";
import { useDashboardGuard } from "./use-dashboard-guard";

interface DashboardGuardProps {
  orgSlug: string;
  wsSlug: string;
  /** Rendered while the session or the workspace is resolving. */
  loadingFallback?: ReactNode;
  children: (ctx: { user: User; workspace: Workspace }) => ReactNode;
}

/**
 * Shared gate for workspace layouts: auth → onboarding → workspace, then the
 * children render with both resolved. Web and any future host compose their
 * own chrome inside; the redirects live in useDashboardGuard.
 */
export function DashboardGuard({ orgSlug, wsSlug, loadingFallback = null, children }: DashboardGuardProps) {
  const { user, workspace } = useDashboardGuard(orgSlug, wsSlug);
  if (!user || !workspace) return <>{loadingFallback}</>;
  return <>{children({ user, workspace })}</>;
}
