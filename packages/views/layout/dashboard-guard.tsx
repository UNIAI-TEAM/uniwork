"use client";

import type { ReactNode } from "react";
import type { User, Workspace } from "@uniwork/core/types";
import { MemberDeactivatedPage } from "../admin/member-deactivated";
import { OrganizationSuspendedPage } from "../admin/organization-suspended";
import { useDashboardGuard } from "./use-dashboard-guard";
import { MEMBER_DEACTIVATED, ORGANIZATION_SUSPENDED, useOrganizationBlock } from "./use-organization-suspended";

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
  const { user, workspace, block } = useDashboardGuard(orgSlug, wsSlug);
  // The block can arrive with the workspace request itself, or later from any
  // other query once an admin switches the person or the tenant off.
  const blockedLater = useOrganizationBlock();
  const blocked = block ?? blockedLater;
  if (blocked === ORGANIZATION_SUSPENDED) return <OrganizationSuspendedPage />;
  if (blocked === MEMBER_DEACTIVATED) return <MemberDeactivatedPage />;
  if (!user || !workspace) return <>{loadingFallback}</>;
  return <>{children({ user, workspace })}</>;
}
