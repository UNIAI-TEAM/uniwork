import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchOrganizations, organizationKeys } from "@uniwork/core/organizations";
import { paths, pendingAuthStep, resolvePostAuthDestination, type AuthGateUser } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations, workspaceKeys } from "@uniwork/core/workspaces";

/**
 * Unverified → /verify; not onboarded with pending invitations → /invitations;
 * otherwise the resolver's verify → onboarding → workspace order. An onboarded
 * person who belongs to no organization lands on /get-started (ADR 0032 D12);
 * a failed organization list is ignored rather than blocking sign-in.
 *
 * Both lookups go through the query cache under the keys the next screen
 * reads, so /invitations and /get-started open on the answer already fetched
 * instead of asking again. `staleTime: 0` so a sign-in always asks the server
 * (never a previous account's cached answer), and no retry: a side lookup
 * never holds sign-in up.
 */
export async function resolveLoggedInDestination(
  user: AuthGateUser,
  workspaces: Workspace[],
  queryClient: QueryClient,
): Promise<string> {
  const step = pendingAuthStep(user);
  if (step === "verify") return paths.verify();
  if (step === "onboarding") {
    try {
      const invites = await queryClient.fetchQuery({
        queryKey: workspaceKeys.myInvitations(),
        queryFn: fetchMyInvitations,
        staleTime: 0,
        retry: false,
      });
      if (invites.length > 0) return paths.invitations();
    } catch {
      /* a side lookup never blocks sign-in */
    }
  }
  const organizations =
    step === null
      ? await queryClient
          .fetchQuery({ queryKey: organizationKeys.list(), queryFn: fetchOrganizations, staleTime: 0, retry: false })
          .catch(() => undefined)
      : undefined;
  return resolvePostAuthDestination(workspaces, user, organizations);
}

/** `resolveLoggedInDestination` bound to the app's query cache, for the sign-in screens. */
export function useLoggedInDestination(): (user: AuthGateUser, workspaces: Workspace[]) => Promise<string> {
  const queryClient = useQueryClient();
  return useCallback((user, workspaces) => resolveLoggedInDestination(user, workspaces, queryClient), [queryClient]);
}
