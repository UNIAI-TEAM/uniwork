// Workspace-wide realtime, mounted once per open workspace by its layout
// (app/(app)/[org]/[ws]/_layout.tsx), which only composes: the chat and call
// hooks, and the workspace list, which any workspace.* frame and every
// reconnect (frames missed meanwhile) refetch.
import { useQueryClient } from "@tanstack/react-query";
import { workspaceKeys } from "../queries/workspaces";
import { useCallRealtime } from "./use-call-realtime";
import { useChatRealtime } from "./use-chat-realtime";
import { useWSSubscriptions } from "./use-ws-subscriptions";

export function useWorkspaceRealtime(wsId: string): void {
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
}
