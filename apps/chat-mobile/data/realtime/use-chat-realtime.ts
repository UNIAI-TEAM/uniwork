// Layer 3 of the realtime stack for chat (apps/chat-mobile/CLAUDE.md): joins
// the workspace's socket subscriptions in [org]/[ws]/_layout.tsx. The frames
// themselves are chat-realtime.ts's; this hook only wires them, picks the
// chat scopes (the open room, then unread, then recent — at most 25, the
// web's selectLazyChatScopeRoomIds), flushes what the phone owes (the outbox
// and the queued reads, reactions and votes of every workspace, owed.ts) when
// the socket comes back, reads the chat change log on opening the workspace
// (data/chat-sync/sync.ts; chat-realtime.ts reads it again on each reconnect
// and every minute the socket is live) — the network edge and the return to the front are
// use-account-sync.ts's, for the whole signed-in app — and keeps presence
// beating while the app is in front.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { selectLazyChatScopeRoomIds } from "@uniwork/core/chat/lazy-chat-scopes";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { syncChat } from "@/data/chat-sync/sync";
import { flushOwed } from "@/data/owed";
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

// Parity: CHAT_PRESENCE_HEARTBEAT_MS in packages/core/chat/presence-heartbeat-coordinator.ts
const HEARTBEAT_MS = 30_000;
const PRESENCE_PRUNE_MS = 2_000;

type PresenceBeatFn = (wsId: string, visible: boolean) => Promise<string[] | null>;

/** Online heartbeat while the app is active (the web's use-chat-presence-heartbeat). */
function useChatPresenceHeartbeat(
  wsId: string,
  userId: string | null,
  beatFnRef: RefObject<PresenceBeatFn | null>,
) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => {
      const sentAt = Date.now();
      const run = beatFnRef.current ?? ((id, visible) => chatApi.beatPresence(id, visible));
      // The phone in front of its user: a visible beat holds back chat pushes to it.
      void run(wsId, true)
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
    // Stopping always leaves: the background and the workspace closing are the only two stops.
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      void chatApi.leavePresence(wsId).catch(bestEffort("presence", "presence not left", "report"));
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else if (state === "background") stop();
    });
    const prune = setInterval(() => usePresenceStore.getState().prune(), PRESENCE_PRUNE_MS);
    return () => {
      sub.remove();
      clearInterval(prune);
      stop();
    };
  }, [wsId, userId, beatFnRef]);
}

export function useChatRealtime(wsId: string) {
  const presenceBeatRef = useRef<PresenceBeatFn | null>(null);
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const activeRoomId = useActiveChatRoomStore((s) => s.roomId);
  const { data: rooms } = useQuery(roomsOptions(wsId));
  const scopeIds = useMemo(() => selectLazyChatScopeRoomIds({ rooms: rooms ?? [], activeRoomId }), [rooms, activeRoomId]);
  useChatScopes(scopeIds);

  useWSSubscriptions(
    (ws) => {
      presenceBeatRef.current = (workspaceId, visible) =>
        ws.sendPresenceBeat(visible).then((online) =>
          online !== null ? online : chatApi.beatPresence(workspaceId, visible),
        );
      const realtime = createChatRealtime(qc, {
        wsId,
        viewer: () => ({ userId: useAuthStore.getState().user?.id ?? null, activeRoomId: useActiveChatRoomStore.getState().roomId }),
        typing: useSidebarTypingStore.getState(),
        presence: usePresenceStore.getState(),
        // What changed since this phone last looked, from the change log (data/chat-sync/sync.ts).
        ...(userId ? { sync: () => syncChat(qc, wsId, userId) } : {}),
        isLive: () => AppState.currentState === "active" && ws.getConnectionState() === "online",
      });
      // Opening the workspace: where the log is, or what changed while the app was closed.
      if (userId) void syncChat(qc, wsId, userId).catch(bestEffort("chat-sync", "first sync threw", "report"));
      return [
        ws.onAny((message) => realtime.handle(message)),
        ws.onReconnect(() => {
          realtime.reconnect();
          if (userId) void flushOwed(qc, userId);
        }),
        realtime.dispose,
        () => useSidebarTypingStore.getState().clearAll(),
        () => usePresenceStore.getState().clearAll(),
        () => {
          presenceBeatRef.current = null;
        },
      ];
    },
    [qc, wsId, userId],
  );

  // A sign-out drops the queued sends: they are the signed-in person's.
  useEffect(() => {
    return useAuthStore.subscribe((state) => {
      if (!state.user) useChatSendStore.getState().clear();
    });
  }, []);

  useEffect(() => {
    void useChatPinsStore.getState().load(wsId);
  }, [wsId]);

  useChatPresenceHeartbeat(wsId, userId, presenceBeatRef);
}
