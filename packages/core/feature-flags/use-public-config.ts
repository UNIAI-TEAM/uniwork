import { useQuery } from "@tanstack/react-query";
import { getPublicConfig, type PublicConfig } from "../api/endpoints/config";

const publicConfigKey = ["public-config"] as const;

/**
 * GET /api/v1/config once per session (F-11): public flags and the RUM
 * sample rate. Hosts mount FeatureFlagsProvider from the answer; until it
 * arrives `data` is undefined and every flag reads its default.
 */
export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: publicConfigKey,
    queryFn: () => getPublicConfig(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
