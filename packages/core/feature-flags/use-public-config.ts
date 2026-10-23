import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPublicConfig, type PublicConfig } from "../api/endpoints/config";

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
