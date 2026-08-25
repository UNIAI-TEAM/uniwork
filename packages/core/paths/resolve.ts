"use client";
import { useSession } from "../auth/hooks";
import type { Workspace } from "../types";
import { paths } from "./paths";
import { RESERVED_SLUGS } from "./reserved-slugs";

/**
 * Ưu tiên onboarded-first: `onboarded_at != null` là nguồn sự thật duy nhất
 * cho việc được vào /{org}/{ws}/* — không suy từ số workspace.
 */
export function resolvePostAuthDestination(workspaces: Workspace[], hasOnboarded: boolean): string {
  if (!hasOnboarded) return paths.onboarding();
  const first = workspaces[0];
  if (first) return paths.workspace(first.organization_slug, first.slug).tasks();
  return paths.newWorkspace();
}

export function useHasOnboarded(): boolean {
  const { user } = useSession();
  return user?.onboarded_at != null;
}

const reserved = new Set<string>(RESERVED_SLUGS);
export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug);
}
