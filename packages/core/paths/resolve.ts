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
type OrganizationGateRef = Pick<Organization, "id" | "status" | "deactivated" | "role">;

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

/**
 * Whether the caller runs the organization. Any member may create a workspace
 * (WorkspaceService.CreateInOrg; canCreateWorkspaceInOrg mirrors it), but who
 * is *sent* to create the first one is a routing choice: the owner or an
 * admin, who opens every workspace anyway. A plain member - or a role this
 * client does not know - waits to be given one.
 */
function runsOrganization(org: OrganizationGateRef): boolean {
  return org.role === "owner" || org.role === "admin";
}

/**
 * Where a signed-in, onboarded person with no workspace to land in goes:
 * no organization → /get-started (ADR 0032 D12); the owner or an admin →
 * create a workspace; a plain member → /no-workspace, told to ask an admin
 * and never put through the create flow (UNI-1472). Without the organization
 * list nothing tells them apart, and creating stays the way on.
 */
export function workspacelessDestination(organizations: readonly OrganizationGateRef[] | undefined): string {
  if (!organizations) return paths.newWorkspace();
  const held = organizations.filter(holdsOrganization);
  if (held.length === 0) return paths.getStarted();
  return held.some(runsOrganization) ? paths.newWorkspace() : paths.noWorkspace();
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
  return workspacelessDestination(organizations);
}

export interface WorkspaceRef {
  orgSlug: string;
  wsSlug: string;
}

/**
 * The workspace a signed-in user's own pages open in ("Home", the account's
 * settings): the one they were last in while they still belong to it,
 * otherwise the first one they may land in. Slugs repeat across
 * organizations, so the match is on the pair. Null while a gate step is
 * still owed, or when there is none.
 */
export function homeWorkspace(
  workspaces: Workspace[],
  user: AuthGateUser | null,
  last: WorkspaceRef | null,
  organizations?: readonly OrganizationGateRef[],
): Workspace | null {
  if (pendingAuthStep(user)) return null;
  const candidates = landable(workspaces, organizations);
  return (
    (last && candidates.find((w) => w.organization_slug === last.orgSlug && w.slug === last.wsSlug)) ?? candidates[0] ?? null
  );
}

/** Where "Home" leads a signed-in user: the home screen of their homeWorkspace, else the gate or the workspaceless landing. */
export function resolveHomeDestination(
  workspaces: Workspace[],
  user: AuthGateUser | null,
  last: WorkspaceRef | null,
  organizations?: readonly OrganizationGateRef[],
): string {
  const step = pendingAuthStep(user);
  if (step) return authStepPath(step);
  const target = homeWorkspace(workspaces, user, last, organizations);
  if (target) return paths.workspace(target.organization_slug, target.slug).root();
  return workspacelessDestination(organizations);
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
