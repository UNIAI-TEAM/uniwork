"use client";

import { useMemo, type ReactNode } from "react";
import { FeatureFlagsProvider, useFeatureFlagService } from "./context";
import { FeatureFlagService } from "./service";
import { StaticProvider } from "./static-provider";
import type { Rule } from "./types";
import { PublicConfigOrganizationContext, usePublicConfig } from "./use-public-config";

/**
 * Mounts the flags of one GET /api/v1/config answer (F-11 §7.2) as a
 * StaticProvider, asked for `organizationId` when given (the workspace shell)
 * and org-less otherwise (the host root). Until the answer arrives a nested
 * provider keeps its parent's flags, so entering a workspace does not flash
 * defaults; a root one reads every default, which is the same thing the
 * server does without a flag file.
 */
export function PublicConfigFlagsProvider({ organizationId, children }: { organizationId?: string; children: ReactNode }) {
  return (
    <PublicConfigOrganizationContext.Provider value={organizationId}>
      <ConfigFlags>{children}</ConfigFlags>
    </PublicConfigOrganizationContext.Provider>
  );
}

function ConfigFlags({ children }: { children: ReactNode }) {
  const parent = useFeatureFlagService();
  const { data } = usePublicConfig();
  const service = useMemo(() => {
    if (!data && parent) return parent;
    const rules: Record<string, Rule> = {};
    for (const [key, value] of Object.entries(data?.flags ?? {})) rules[key] = { default: value };
    return new FeatureFlagService(new StaticProvider(rules));
  }, [data, parent]);
  return <FeatureFlagsProvider service={service}>{children}</FeatureFlagsProvider>;
}
