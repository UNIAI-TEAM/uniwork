// Layer 3 of the realtime stack for chat (apps/chat-mobile/CLAUDE.md): joins
// the workspace's socket subscriptions in [org]/[ws]/_layout.tsx. The frames
// themselves are chat-realtime.ts's; this hook only wires them, picks the
// chat scopes (the open room, then unread, then recent — at most 25, the
// web's selectLazyChatScopeRoomIds), flushes the outbox and the queued reads,
// reactions and votes when the workspace opens, the network or the socket
// comes back, or the app returns to the front, and keeps presence beating
// while the app is in front.
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { selectLazyChatScopeRoomIds } from "@uniwork/core/chat/lazy-chat-scopes";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { chatSendDeps, flushQueuedSends } from "@/data/chat-send";
import { flushPendingOps, pendingOpsDeps } from "@/data/pending-ops";
import { roomsOptions } from "@/data/queries/chat";
import { bestEffort } from "@/data/report";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useChatSendStore } from "@/data/stores/chat-send-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { useWSSubscriptions } from "@/data/realtime/use-ws-subscriptions";
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
        .catch(bestEffort("presence", "presence beat failed", "report"));
    };
    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = (leave: boolean) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (leave) void chatApi.leavePresence(wsId).catch(bestEffort("presence", "presence not left", "report"));
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

/** What the phone owes the server: the unsent messages, then the queued reads, reactions and votes. */
function flushOwed(qc: QueryClient, wsId: string, userId: string): void {
  void flushQueuedSends(qc, wsId, userId, chatSendDeps);
  void flushPendingOps(qc, wsId, userId, pendingOpsDeps);
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
          if (userId) flushOwed(qc, wsId, userId);
        }),
        realtime.dispose,
        () => useSidebarTypingStore.getState().clearAll(),
        () => usePresenceStore.getState().clearAll(),
      ];
    },
    [qc, wsId, userId],
  );

  // The outbox goes when the workspace opens (messages kept from the last run), on NetInfo's
  // offline → online edge without waiting for the socket, and on each return to the foreground.
  useEffect(() => {
    if (!userId) return;
    const flush = () => flushOwed(qc, wsId, userId);
    flush();
    let wasOnline = onlineManager.isOnline();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      if (online && !wasOnline) flush();
      wasOnline = online;
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    return () => {
      unsubscribeNet();
      appState.remove();
    };
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
