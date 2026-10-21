// Ported from usf apps/mobile/app/(app)/[workspace]/_layout.tsx. The URL pair
// is the source of truth: validated against the workspace list, synced into
// the store, and the realtime socket lives for the workspace session.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { useEffect, useMemo } from "react";
import { ErrorFallback } from "@/components/ui/error-fallback";
import { session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { useVoiceCall } from "@/data/calls/call-store";
import { workspaceKeys, workspaceListOptions } from "@/data/queries/workspaces";
import { useRemoteConfigOrganization } from "@/data/remote-config";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { useCallRealtime } from "@/data/realtime/use-call-realtime";
import { useChatRealtime } from "@/data/realtime/use-chat-realtime";
import { socketTokenReaders } from "@/data/realtime/refresh-for-socket";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { callHoldsSocket } from "@/lib/call-socket";
import { useWSSubscriptions } from "@/data/realtime/use-ws-subscriptions";

/** A cold-start deep link mounts the tabs under the target, so back has somewhere to go. */
export const unstable_settings = { anchor: "(tabs)" } as const;

/** A crash inside one workspace keeps the shell (and a call's overlay) and offers a retry. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} boundary="workspace" />;
}

/** Workspace-wide subscriptions; feature hooks join them here. */
function RealtimeSubscriptions({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient();
  useChatRealtime(wsId);
  useCallRealtime(wsId);
  useWSSubscriptions(
    (ws) => [
      ws.onAny((message) => {
        if (message.type.startsWith("workspace.")) void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
      }),
      ws.onReconnect(() => void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })),
    ],
    [queryClient],
  );
  return null;
}

export default function WorkspaceLayout() {
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: workspaces, isError } = useQuery(workspaceListOptions());
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  const tokens = useMemo(() => socketTokenReaders(session), []);
  // A call that rings, connects or is on keeps the socket open in the background (audit C1).
  const holdOpen = callHoldsSocket(useVoiceCall());

  const matched = workspaces?.find((w) => w.organization_slug === org && w.slug === ws);
  // The kill switches are evaluated for this workspace's organization (data/remote-config.ts).
  useRemoteConfigOrganization(matched?.organization_id ?? null);

  useEffect(() => {
    if (matched) void setCurrent({ orgSlug: matched.organization_slug, wsSlug: matched.slug, wsId: matched.id });
  }, [matched, setCurrent]);

  // Decide membership only on a loaded list: offline, the query is paused with
  // no data and isLoading false, and a valid link must not bounce then.
  if (!workspaces && !isError) return null;
  if (!matched) return <Redirect href="/select-workspace" />;

  return (
    <RealtimeProvider
      userId={userId}
      workspaceSlug={`${org}/${ws}`}
      getToken={tokens.getToken}
      refreshSession={tokens.refreshSession}
      holdOpen={holdOpen}
    >
      <RealtimeSubscriptions wsId={matched.id} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </RealtimeProvider>
  );
}
