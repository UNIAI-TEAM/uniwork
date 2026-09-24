"use client";

import {
  isGlobalPath as coreIsGlobalPath,
  isReservedSlug as coreIsReservedSlug,
  paths as corePaths,
} from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";

export function useEditorWorkspaceSlug(): string {
  const ctx = useOptionalWorkspace();
  if (!ctx) return "";
  return `${ctx.workspace.organization_slug}/${ctx.workspace.slug}`;
}

export const paths = corePaths;
export const isGlobalPath = coreIsGlobalPath;
export const isReservedSlug = coreIsReservedSlug;
