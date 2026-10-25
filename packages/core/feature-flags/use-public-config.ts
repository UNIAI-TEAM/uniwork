import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPublicConfig, type PublicConfig } from "../api/endpoints/config";
import { OFFICE_ENGINE_FLAG } from "../office/format-flags";

const publicConfigKeys = {
  all: ["public-config"] as const,
  organization: (organizationId: string) => [...publicConfigKeys.all, organizationId] as const,
};

/**
 * The organization GET /api/v1/config is asked for. Organization-scoped flag
 * overrides only evaluate when the server is told the organization, so
 * PublicConfigFlagsProvider sets it for the workspace shell; unset, the
 * answer is org-less.
 */
export const PublicConfigOrganizationContext = createContext<string | undefined>(undefined);

/**
 * GET /api/v1/config once per session and organization (F-11): public flags
 * and the RUM sample rate. Hosts mount PublicConfigFlagsProvider from the
 * answer; until it arrives `data` is undefined and every flag reads its default.
 */
export function usePublicConfig(options?: { enabled?: boolean }) {
  const organizationId = useContext(PublicConfigOrganizationContext);
  return useQuery<PublicConfig>({
    queryKey: organizationId ? publicConfigKeys.organization(organizationId) : publicConfigKeys.all,
    queryFn: () => getPublicConfig(organizationId),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
    gcTime: Infinity,
    retry: false,
  });
}

/** One organization's /config answer; the key keeps its first owner's name. */
const organizationConfigKeys = {
  all: ["office-public-config"] as const,
  organization: (organizationId: string) => [...organizationConfigKeys.all, organizationId] as const,
};

/**
 * A 200 whose body drifted degrades to `flags: {}` in `getPublicConfig`. The
 * server publishes `office_engine` (a public key) in every healthy answer, so
 * its absence means the answer is unusable: an error, retried and never cached
 * as a settled "off" for the query's stale time (UNI-954 R4-4).
 */
async function fetchOrganizationConfig(organizationId: string | undefined) {
  const config = await getPublicConfig(organizationId);
  if (typeof config.flags[OFFICE_ENGINE_FLAG] !== "boolean") throw new Error("office_config_unreadable");
  return config;
}

/**
 * GET /api/v1/config for one organization: organization-scoped overrides only
 * evaluate when /config is asked for it. Idle without an organization id.
 */
export function useOrganizationConfig(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationConfigKeys.organization(organizationId ?? ""),
    queryFn: () => fetchOrganizationConfig(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
