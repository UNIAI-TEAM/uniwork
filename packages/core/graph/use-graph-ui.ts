import { useQuery } from "@tanstack/react-query";
import { getPublicConfig } from "../api/endpoints/config";

const GRAPH_UI_FLAG = "graph_ui";

/**
 * Whether the Work Graph UI is on for an organization. Organization-scoped
 * overrides only evaluate when /config is asked for that organization, so
 * this reads its own answer (the useOfficeEnabled pattern). `on` only once
 * the answer arrived; `unknown` when it cannot be read.
 */
export function useGraphUI(organizationId: string | undefined): "loading" | "on" | "off" | "unknown" {
  const query = useQuery({
    queryKey: ["graph-public-config", organizationId ?? ""],
    queryFn: async () => {
      const config = await getPublicConfig(organizationId);
      if (typeof config.flags[GRAPH_UI_FLAG] !== "boolean") throw new Error("graph_config_unreadable");
      return config;
    },
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  if (!organizationId) return "off";
  if (query.data) return query.data.flags[GRAPH_UI_FLAG] ? "on" : "off";
  return query.isError ? "unknown" : "loading";
}
