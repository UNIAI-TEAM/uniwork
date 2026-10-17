// Ported from usf apps/mobile/app/(app)/[workspace]/_layout.tsx. The URL pair
// is the source of truth: validated against the workspace list, synced into
// the store, and the realtime socket lives for the workspace session.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

/** A cold-start deep link mounts the tabs under the target, so back has somewhere to go. */
export const unstable_settings = { anchor: "(tabs)" } as const;

/** Workspace-wide subscriptions; feature hooks (M2a) join them here. */
function RealtimeSubscriptions() {
  const queryClient = useQueryClient();
  useWSSubscriptions(
    (ws) => [
      ws.onAny((message) => {
        if (message.type.startsWith("workspace.")) void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      }),
      ws.onReconnect(() => void queryClient.invalidateQueries({ queryKey: ["workspaces"] })),
    ],
    [queryClient],
  );
  return null;
}

export default function WorkspaceLayout() {
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: workspaces, isLoading } = useQuery(workspaceListOptions());
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);

  const matched = workspaces?.find((w) => w.organization_slug === org && w.slug === ws);

  useEffect(() => {
    if (matched) void setCurrent({ orgSlug: matched.organization_slug, wsSlug: matched.slug, wsId: matched.id });
  }, [matched, setCurrent]);

  // Decide membership only once the list is in; a valid link must not bounce on cold start.
  if (isLoading) return null;
  if (!matched) return <Redirect href="/select-workspace" />;

  return (
    <RealtimeProvider
      userId={userId}
      workspaceSlug={`${org}/${ws}`}
      getToken={() => session.getAccessToken()}
      refreshSession={() => session.refresh()}
    >
      <RealtimeSubscriptions />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </RealtimeProvider>
  );
}
