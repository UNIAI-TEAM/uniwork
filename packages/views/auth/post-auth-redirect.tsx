import { fetchOrganizations } from "@uniwork/core/organizations";
import { paths, pendingAuthStep, resolvePostAuthDestination, type AuthGateUser } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations } from "@uniwork/core/workspaces";

/**
 * Unverified → /verify; not onboarded with pending invitations → /invitations;
 * otherwise the resolver's verify → onboarding → workspace order. An onboarded
 * person who belongs to no organization lands on /get-started (ADR 0032 D12);
 * a failed organization list is ignored rather than blocking sign-in.
 */
export async function resolveLoggedInDestination(user: AuthGateUser, workspaces: Workspace[]): Promise<string> {
  const step = pendingAuthStep(user);
  if (step === "verify") return paths.verify();
  if (step === "onboarding") {
    try {
      const invites = await fetchMyInvitations();
      if (invites.length > 0) return paths.invitations();
    } catch {
      /* a side lookup never blocks sign-in */
    }
  }
  const organizations = step === null ? await fetchOrganizations().catch(() => undefined) : undefined;
  return resolvePostAuthDestination(workspaces, user, organizations);
}
