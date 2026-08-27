"use client";
import { useSession } from "../auth/hooks";
import type { User, Workspace } from "../types";
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

export function resolvePostAuthDestination(workspaces: Workspace[], user: AuthGateUser | null): string {
  const step = pendingAuthStep(user);
  if (step) return authStepPath(step);
  const first = workspaces[0];
  if (first) return paths.workspace(first.organization_slug, first.slug).tasks();
  return paths.newWorkspace();
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
