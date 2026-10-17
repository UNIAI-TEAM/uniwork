// Layer 3 of the realtime stack for chat (apps/chat-mobile/CLAUDE.md): joins
// the workspace's socket subscriptions in [org]/[ws]/_layout.tsx. The frames
// themselves are chat-realtime.ts's; this hook only wires them, picks the
// chat scopes (the open room, then unread, then recent — at most 25, the
// web's selectLazyChatScopeRoomIds), flushes queued sends when the network or
// the socket comes back, and keeps presence beating while the app is in front.
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { selectLazyChatScopeRoomIds } from "@uniwork/core/chat/lazy-chat-scopes";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { chatSendDeps, flushQueuedSends } from "@/data/chat-send";
import { roomsOptions } from "@/data/queries/chat";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useChatSendStore } from "@/data/stores/chat-send-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { createChatRealtime } from "./chat-realtime";
import { useChatScopes } from "./use-chat-scopes";

const HEARTBEAT_MS = 15_000;
const PRESENCE_PRUNE_MS = 2_000;

/** Online heartbeat every 15 s while the app is active (the web's use-chat-presence-heartbeat). */
function useChatPresenceHeartbeat(wsId: string, userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => {
      const sentAt = Date.now();
      // The phone in front of its user: a visible beat holds back chat pushes to it.
      void chatApi
        .beatPresence(wsId, true)
        .then((online) => {
          if (online) usePresenceStore.getState().reconcile(online, userId, sentAt);
        })
        .catch(() => undefined);
    };
    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = (leave: boolean) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (leave) void chatApi.leavePresence(wsId).catch(() => undefined);
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else if (state === "background") stop(true);
    });
    const prune = setInterval(() => usePresenceStore.getState().prune(), PRESENCE_PRUNE_MS);
    return () => {
      sub.remove();
      clearInterval(prune);
      stop(true);
    };
  }, [wsId, userId]);
}

export function useChatRealtime(wsId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const activeRoomId = useActiveChatRoomStore((s) => s.roomId);
  const { data: rooms } = useQuery(roomsOptions(wsId));
  const scopeIds = useMemo(() => selectLazyChatScopeRoomIds({ rooms: rooms ?? [], activeRoomId }), [rooms, activeRoomId]);
  useChatScopes(scopeIds);

  useWSSubscriptions(
    (ws) => {
      const realtime = createChatRealtime(qc, {
        wsId,
        viewer: () => ({ userId: useAuthStore.getState().user?.id ?? null, activeRoomId: useActiveChatRoomStore.getState().roomId }),
        typing: useSidebarTypingStore.getState(),
        presence: usePresenceStore.getState(),
      });
      return [
        ws.onAny((message) => realtime.handle(message)),
        ws.onReconnect(() => {
          realtime.reconnect();
          if (userId) void flushQueuedSends(qc, wsId, userId, chatSendDeps);
        }),
        realtime.dispose,
        () => useSidebarTypingStore.getState().clearAll(),
        () => usePresenceStore.getState().clearAll(),
      ];
    },
    [qc, wsId, userId],
  );

  // NetInfo's offline → online edge: queued sends go without waiting for the socket.
  useEffect(() => {
    if (!userId) return;
    let wasOnline = onlineManager.isOnline();
    return NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      if (online && !wasOnline) void flushQueuedSends(qc, wsId, userId, chatSendDeps);
      wasOnline = online;
    });
  }, [qc, wsId, userId]);

  // A sign-out drops the queued sends: they are the signed-in person's.
  useEffect(
    () =>
      useAuthStore.subscribe((state) => {
        if (!state.user) useChatSendStore.getState().clear();
      }),
    [],
  );

  useEffect(() => {
    void useChatPinsStore.getState().load(wsId);
  }, [wsId]);

  useChatPresenceHeartbeat(wsId, userId);
}
