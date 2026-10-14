import * as auth from "../api/endpoints/auth";
import { setSessionUser } from "../auth/hooks";
import { useAuthStore } from "../auth/store";
import { organizationKeys } from "../organizations/hooks";
import type { WSEventType } from "../types/events";
import { workspaceKeys } from "../workspaces/keys";

/**
 * Whether a frame changes which organization the signed-in user belongs to
 * (ADR 0032): their own member.left / member.joined — a leave, a close or an
 * accepted invitation done in another tab — or organization.closed, which
 * only reaches members of the closed organization.
 */
export function changesOwnMembership(type: WSEventType, payload: Record<string, string>): boolean {
  if (type === "organization.closed") return true;
  if (type !== "member.left" && type !== "member.joined") return false;
  const userId = useAuthStore.getState().user?.id;
  return !!userId && payload.user_id === userId;
}

/** The lists the entry gates route on; stale ones would keep a closed organization reachable. */
export const ownMembershipKeys = [organizationKeys.list(), workspaceKeys.list()] as const;

/**
 * The session user is not a query: refetch it the way useAcceptInvite does,
 * unless the session ended or changed hands while the request was out.
 */
export async function reloadSessionUser(): Promise<void> {
  const user = await auth.me().catch(() => null);
  if (user && useAuthStore.getState().user?.id === user.id) setSessionUser(user);
}
