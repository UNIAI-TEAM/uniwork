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
  // The block arrived after the workspace had opened: the page the person
  // was using is gone, so the notice's heading takes focus to say so.
  const announce = !block && !!user && !!workspace;
  if (blocked === ORGANIZATION_SUSPENDED) return <SuspendedOrClosed orgSlug={orgSlug} announce={announce} />;
  if (blocked === MEMBER_DEACTIVATED) return <MemberDeactivatedPage announce={announce} />;
  if (!user || !workspace) return <>{loadingFallback}</>;
  return <>{children({ user, workspace })}</>;
}

/**
 * A closed organization is archived (ADR 0032 D4), and its routes refuse with
 * organization_suspended like a suspended one. GET /orgs tells them apart: a
 * suspended organization is still listed, a closed one is not. The person who
 * no longer belongs to it goes where the entry gates would send them — another
 * workspace, or /get-started — instead of reading about a pause. While the
 * organization list loads nothing is said, since the notice may be wrong: the
 * notice's own frame stands in its loading state, so the page is not blank
 * and the notice lands in place without the frame mounting twice. If the list
 * fails the suspended notice stands, without the name it would have carried.
 */
function SuspendedOrClosed({ orgSlug, announce }: { orgSlug: string; announce: boolean }) {
  const { replace } = useNavigation();
  const { user } = useSession();
  const { data: organizations, isPending: organizationsLoading } = useOrganizations();
  const { data: workspaces, isError: workspacesFailed } = useWorkspaces();
  const gone = !!organizations && !organizations.some((o) => o.slug === orgSlug);
  // A failed workspace list still has an answer: the organization list alone
  // tells /get-started from "create a workspace in the one you have". This
  // organization refuses the person, so its own workspaces are no way out.
  const settled = workspaces ?? (workspacesFailed ? [] : null);
  const elsewhere = settled?.filter((w) => w.organization_slug !== orgSlug) ?? null;
  const destination = gone && elsewhere ? resolvePostAuthDestination(elsewhere, user, organizations) : null;
  useEffect(() => {
    if (destination) replace(destination);
  }, [destination, replace]);
  if (gone || organizationsLoading) return <OrganizationSuspendedPage loading announce={announce} />;
  return (
    <OrganizationSuspendedPage organization={organizations?.find((o) => o.slug === orgSlug)} announce={announce} />
  );
}
