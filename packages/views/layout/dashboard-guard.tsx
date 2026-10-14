"use client";

import { useEffect, type ReactNode } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { resolvePostAuthDestination } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { MemberDeactivatedPage } from "../admin/member-deactivated";
import { useNavigation } from "../navigation";
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
  if (blocked === ORGANIZATION_SUSPENDED) return <SuspendedOrClosed orgSlug={orgSlug} />;
  if (blocked === MEMBER_DEACTIVATED) return <MemberDeactivatedPage />;
  if (!user || !workspace) return <>{loadingFallback}</>;
  return <>{children({ user, workspace })}</>;
}

/**
 * A closed organization is archived (ADR 0032 D4), and its routes refuse with
 * organization_suspended like a suspended one. GET /orgs tells them apart: a
 * suspended organization is still listed, a closed one is not. The person who
 * no longer belongs to it goes where the entry gates would send them — another
 * workspace, or /get-started — instead of reading about a pause. Until the
 * organization list is in (or if it fails) the suspended notice stands.
 */
function SuspendedOrClosed({ orgSlug }: { orgSlug: string }) {
  const { replace } = useNavigation();
  const { user } = useSession();
  const { data: organizations } = useOrganizations();
  const { data: workspaces, isError: workspacesFailed } = useWorkspaces();
  const gone = !!organizations && !organizations.some((o) => o.slug === orgSlug);
  // A failed workspace list still has an answer: the organization list alone
  // tells /get-started from "create a workspace in the one you have".
  const settled = workspaces ?? (workspacesFailed ? [] : null);
  const destination = gone && settled ? resolvePostAuthDestination(settled, user, organizations) : null;
  useEffect(() => {
    if (destination) replace(destination);
  }, [destination, replace]);
  if (gone) return null;
  return <OrganizationSuspendedPage />;
}
