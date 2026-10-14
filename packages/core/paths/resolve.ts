"use client";
import { useSession } from "../auth/hooks";
import { holdsOrganization, type Organization, type User, type Workspace } from "../types";
import { paths } from "./paths";
import { RESERVED_SLUGS } from "./reserved-slugs";

export type AuthStep = "verify" | "onboarding";
export type AuthGateUser = Pick<User, "email_verified_at" | "onboarded_at">;

/**
 * The one place the order of the entry gates lives: an unverified email comes
 * before onboarding, and `onboarded_at != null` is the single source of truth
 * for entering /{org}/{ws}/* — never the workspace count. Every guard and
 * every (auth) page routes through this instead of reading the fields itself.
 */
export function pendingAuthStep(user: AuthGateUser | null | undefined): AuthStep | null {
  if (!user) return null;
  if (user.email_verified_at == null) return "verify";
  if (user.onboarded_at == null) return "onboarding";
  return null;
}

export function authStepPath(step: AuthStep): string {
  return step === "verify" ? paths.verify() : paths.onboarding();
}

/**
 * What the entry gates read from GET /orgs, which leaves archived
 * organizations out but keeps switched-off memberships (F-03 §6.3).
 */
type OrganizationGateRef = Pick<Organization, "id" | "status" | "deactivated">;

/**
 * The workspaces a person may land in. GET /workspaces already leaves closed
 * organizations out, but keeps the workspaces of a switched-off membership
 * (ADR 0032 D1): the organization list names those, and only those are
 * dropped. A workspace whose organization the list does not name stays, so
 * an empty or drifted list (it degrades to []) never hides a workspace the
 * server still lists. A suspended organization still counts, and its gate
 * explains itself.
 */
function landable(workspaces: Workspace[], organizations: readonly OrganizationGateRef[] | undefined): Workspace[] {
  if (!organizations) return workspaces;
  const released = new Set(organizations.filter((o) => !holdsOrganization(o)).map((o) => o.id));
  return workspaces.filter((w) => !released.has(w.organization_id));
}

/** No workspace to land in: create one in the organization, or start over without one (D12). */
function emptyDestination(organizations: readonly OrganizationGateRef[] | undefined): string {
  if (organizations && !organizations.some(holdsOrganization)) return paths.getStarted();
  return paths.newWorkspace();
}

export function resolvePostAuthDestination(
  workspaces: Workspace[],
  user: AuthGateUser | null,
  organizations?: readonly OrganizationGateRef[],
): string {
  const step = pendingAuthStep(user);
  if (step) return authStepPath(step);
  const first = landable(workspaces, organizations)[0];
  if (first) return paths.workspace(first.organization_slug, first.slug).tasks();
  return emptyDestination(organizations);
}

export interface WorkspaceRef {
  orgSlug: string;
  wsSlug: string;
}

/**
 * Where "Home" leads a signed-in user: the home screen of the workspace they
 * were last in while they still belong to it, otherwise of the first one.
 * Slugs repeat across organizations, so the match is on the pair.
 */
export function resolveHomeDestination(
  workspaces: Workspace[],
  user: AuthGateUser | null,
  last: WorkspaceRef | null,
  organizations?: readonly OrganizationGateRef[],
): string {
  const step = pendingAuthStep(user);
  if (step) return authStepPath(step);
  const candidates = landable(workspaces, organizations);
  const target =
    (last && candidates.find((w) => w.organization_slug === last.orgSlug && w.slug === last.wsSlug)) ?? candidates[0];
  if (target) return paths.workspace(target.organization_slug, target.slug).root();
  return emptyDestination(organizations);
}

export function useHasOnboarded(): boolean {
  const { user } = useSession();
  return user?.onboarded_at != null;
}

/** The gate step the signed-in user still has to pass, or null. */
export function usePendingAuthStep(): AuthStep | null {
  const { user } = useSession();
  return pendingAuthStep(user);
}

const reserved = new Set<string>(RESERVED_SLUGS);
export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug);
}
