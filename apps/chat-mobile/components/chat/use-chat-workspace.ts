// The workspace a chat screen sits in, from the route pair. The workspace
// layout has already validated the pair against the cached workspace list, so
// this only reads that cache (no request of its own).
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useAuthStore } from "@/data/auth/store";
import { workspaceListOptions } from "@/data/queries/workspaces";

export interface ChatWorkspace {
  wsId: string;
  orgSlug: string;
  wsSlug: string;
  workspaceName: string;
  userId: string;
}

export function useChatWorkspace(): ChatWorkspace | null {
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data } = useQuery(workspaceListOptions());
  const matched = data?.find((w) => w.organization_slug === org && w.slug === ws);
  return useMemo(
    () =>
      matched && userId
        ? { wsId: matched.id, orgSlug: matched.organization_slug, wsSlug: matched.slug, workspaceName: matched.name, userId }
        : null,
    [matched, userId],
  );
}
