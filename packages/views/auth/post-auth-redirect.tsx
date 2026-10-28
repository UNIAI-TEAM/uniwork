import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchOrganizations, organizationKeys } from "@uniwork/core/organizations";
import {
  nextOverridesOnboarding,
  paths,
  pendingAuthStep,
  resolvePostAuthDestination,
  sanitizeNextUrl,
  type AuthGateUser,
} from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations, workspaceKeys } from "@uniwork/core/workspaces";

const PATH_PROBE = "https://app.invalid";

/**
 * Pages a signed-in person reaches even while a gate step is still owed (spec
 * §4.2): the desktop or phone app's consent, since the app deals with an
 * account that has no workspace yet, and the choice screen's link step, which
 * only links a provider to the account that just signed in. Sending either
 * through /verify or /onboarding first would leave the app waiting until its
 * attempt expires, or the pending sign-in until its ticket does.
 */
function skipsEntryGates(next: string): boolean {
  return new URL(next, PATH_PROBE).pathname === paths.desktopAuthorize() || isLinkStep(next);
}

/**
 * `next` is the choice screen's link step (`/auth/continue?step=link…`): the
 * sign-in it follows is "I already have an account" (spec §4.4), and keeps
 * the pending sign-in so that step can link it.
 */
export function isLinkStep(next: string | null | undefined): boolean {
  if (!next) return false;
  const url = new URL(next, PATH_PROBE);
  return url.pathname === paths.authContinue() && url.searchParams.get("step") === "link";
}

/**
 * Where a sign-in goes once it is no longer about linking ("Không liên
 * kết", or a register that drops the pending sign-in): the link step's own
 * `next`, sanitized again; any other `next` as it is.
 */
export function pastLinkStep(next: string | null | undefined): string | null {
  if (!next || !isLinkStep(next)) return next ?? null;
  return sanitizeNextUrl(new URL(next, PATH_PROBE).searchParams.get("next"));
}

/**
 * Where `next` goes once a gate step is behind the person: the gate's own
 * page carries it, and it wins over every landing that is not a gate. A
 * membership link or an email invitation goes before onboarding instead:
 * accepting it onboards the person, and onboarding would have them create an
 * organization first (UNI-2226).
 */
function carryNext(destination: string, next: string | null): string {
  if (!next) return destination;
  if (destination === paths.verify()) return paths.verify({ next });
  if (destination === paths.onboarding()) return nextOverridesOnboarding(next) ? next : paths.onboarding({ next });
  return next;
}

/**
 * Unverified → /verify; not onboarded with pending invitations → /invitations;
 * otherwise the resolver's verify → onboarding → workspace order. An onboarded
 * person who belongs to no organization lands on /get-started (ADR 0032 D12);
 * a failed organization list is ignored rather than blocking sign-in.
 *
 * `next` (sanitized again here: same-origin paths only) survives the gates:
 * /verify and /onboarding carry it and go on to it afterwards (a join or
 * email-invite `next` skips onboarding), and any other landing gives way to
 * it. The consent and link-step pages above skip the gates altogether.
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
  next?: string | null,
): Promise<string> {
  const target = sanitizeNextUrl(next);
  if (target && skipsEntryGates(target)) return target;
  const step = pendingAuthStep(user);
  if (step === "verify") return paths.verify({ next: target });
  if (step === "onboarding") {
    try {
      const invites = await queryClient.fetchQuery({
        queryKey: workspaceKeys.myInvitations(),
        queryFn: fetchMyInvitations,
        staleTime: 0,
        retry: false,
      });
      if (invites.length > 0) return target ?? paths.invitations();
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
  return carryNext(resolvePostAuthDestination(workspaces, user, organizations), target);
}

/** `resolveLoggedInDestination` bound to the app's query cache, for the sign-in screens. */
export function useLoggedInDestination(): (
  user: AuthGateUser,
  workspaces: Workspace[],
  next?: string | null,
) => Promise<string> {
  const queryClient = useQueryClient();
  return useCallback(
    (user, workspaces, next) => resolveLoggedInDestination(user, workspaces, queryClient, next),
    [queryClient],
  );
}
