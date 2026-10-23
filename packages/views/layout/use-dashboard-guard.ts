"use client";

import { useEffect, useRef } from "react";
import { errorCode } from "@uniwork/core/api";
import { hasSessionHint, useSession } from "@uniwork/core/auth";
import { authStepPath, paths, pendingAuthStep } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { rememberLastWorkspace, useWorkspace } from "@uniwork/core/workspaces";
import { useNavigation } from "../navigation";
import {
  MEMBER_DEACTIVATED,
  ORGANIZATION_SUSPENDED,
  type OrganizationBlock,
} from "./use-organization-suspended";

/**
 * Auth + workspace gate for every /{org}/{ws}/* screen.
 *
 *  - session loading            → wait
 *  - anonymous                  → /login?next=<current path + query>
 *                                 (a ?comment= deep link survives sign-in);
 *                                 &reason=session_expired when this browser
 *                                 held a session a moment ago
 *  - signed in, email unverified → /verify
 *  - signed in, not onboarded   → /onboarding (onboarded_at is the single
 *                                 source of truth, never the workspace count)
 *    (both decided by pendingAuthStep, which owns the order)
 *  - organization suspended, or
 *    membership deactivated     → stay; the shell shows the notice
 *  - URL pair does not resolve  → /workspaces
 *
 * Runs through the navigation adapter, so the same guard serves any host.
 */
export function useDashboardGuard(
  orgSlug: string,
  wsSlug: string,
): { user: User | null; workspace: Workspace | null; isLoading: boolean; block: OrganizationBlock } {
  const { pathname, replace, searchParams } = useNavigation();
  const query = searchParams.toString();
  const here = query ? `${pathname}?${query}` : pathname;
  const { user, status } = useSession();
  // Whether a session existed: the browser's hint is read on the first render,
  // before the start-up refresh fails and clears it, or the page saw it authed.
  const hadSession = useRef<boolean | null>(null);
  hadSession.current ??= hasSessionHint();
  if (status === "authed") hadSession.current = true;
  const {
    data: workspace,
    error,
    isLoading: workspaceLoading,
  } = useWorkspace(status === "authed" ? orgSlug : "", wsSlug);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anon") {
      replace(`${paths.login()}?next=${encodeURIComponent(here)}${hadSession.current ? "&reason=session_expired" : ""}`);
      return;
    }
    const step = pendingAuthStep(user);
    if (step) {
      replace(authStepPath(step));
      return;
    }
    if (blockFromError(error)) return;
    // A drifted response resolves to null rather than an error; both mean
    // "this URL is not a workspace you can see".
    if (error || (!workspaceLoading && workspace === null)) replace(paths.workspaces());
  }, [status, user, error, workspace, workspaceLoading, replace, here]);

  const ready = status === "authed" && !!user && pendingAuthStep(user) === null && !!workspace;

  // An old slug resolves through its alias (spec 2026-10-14 §6.2): move the
  // URL to the workspace's current slug, keeping the rest of the path and the
  // query, so links and bookmarks from before a rename keep working.
  // Gated on `ready` so a pending auth/onboarding step is not overridden.
  const currentSlug = ready ? workspace.slug : null;
  useEffect(() => {
    if (!currentSlug || currentSlug === wsSlug) return;
    const query = searchParams.toString();
    replace(withWorkspaceSlug(pathname, currentSlug) + (query ? `?${query}` : ""));
  }, [currentSlug, wsSlug, pathname, searchParams, replace]);

  const userId = ready ? user.id : null;
  const orgSlugIn = ready ? workspace.organization_slug : null;
  const wsSlugIn = ready ? workspace.slug : null;
  useEffect(() => {
    if (userId && orgSlugIn && wsSlugIn) rememberLastWorkspace(userId, { orgSlug: orgSlugIn, wsSlug: wsSlugIn });
  }, [userId, orgSlugIn, wsSlugIn]);

  return {
    user: ready ? user : null,
    workspace: ready ? workspace : null,
    isLoading: status === "loading" || workspaceLoading,
    block: blockFromError(error),
  };
}

/**
 * A 403 that means "you cannot be in here" rather than "this workspace is not
 * yours": the shell shows a notice instead of redirecting to the picker, which
 * would only bounce the person straight back.
 */
function blockFromError(error: unknown): OrganizationBlock {
  const code = errorCode(error);
  if (code === ORGANIZATION_SUSPENDED) return ORGANIZATION_SUSPENDED;
  if (code === MEMBER_DEACTIVATED) return MEMBER_DEACTIVATED;
  return null;
}

/** /{org}/{oldSlug}/rest → /{org}/{slug}/rest. */
function withWorkspaceSlug(pathname: string, slug: string): string {
  const parts = pathname.split("/");
  if (parts.length < 3) return pathname;
  parts[2] = encodeURIComponent(slug);
  return parts.join("/");
}
