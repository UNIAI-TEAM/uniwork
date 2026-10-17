// Layer 3 of the realtime stack for calls (spec cha §8: chat.voice.* → the call
// overlay): hands the user-scope call frames to the call engine, and asks for
// the invites still ringing when the workspace opens and after every
// reconnect, as the web's use-native-voice-call does.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@/data/auth/store";
import { callEngine } from "@/data/calls/call-store";
import { roomsOptions } from "@/data/queries/chat";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useCallRealtime(wsId: string) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: rooms } = useQuery(roomsOptions(wsId));
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  useEffect(() => {
    if (!userId) return;
    callEngine.configure({ wsId, userId, allowedRoomIds: () => new Set((roomsRef.current ?? []).map((room) => room.id)) });
    void callEngine.syncPendingInvites();
    return () => callEngine.configure(null);
  }, [wsId, userId]);

  useWSSubscriptions(
    (ws) => [
      ws.on("chat.voice.invite", (payload) => callEngine.onInvite(payload)),
      ws.on("chat.voice.accept", (payload) => callEngine.onAccept(payload)),
      ws.on("chat.voice.hangup", (payload) => callEngine.onHangup(payload)),
      ws.onReconnect(() => void callEngine.syncPendingInvites()),
    ],
    [],
  );
}
