// Layer 3 of the realtime stack for calls (spec cha §8: chat.voice.* → the call
// overlay): hands the user-scope call frames to the call engine, and asks for
// the invites still ringing when the workspace opens and after every
// reconnect, as the web's use-native-voice-call does. With the server's calls
// switch off (data/remote-config.ts) nothing rings: invites are not handed on
// and none are asked for; a call already under way still hears its accept
// and hang-up, so turning the switch off never strands one.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@/data/auth/store";
import { callEngine } from "@/data/calls/call-store";
import { roomsOptions } from "@/data/queries/chat";
import { useMobileFlag } from "@/data/remote-config";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useCallRealtime(wsId: string) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: rooms } = useQuery(roomsOptions(wsId));
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const callsOnRef = useRef(callsOn);
  callsOnRef.current = callsOn;

  useEffect(() => {
    if (!userId) return;
    const detach = callEngine.attach({ wsId, userId, allowedRoomIds: () => new Set((roomsRef.current ?? []).map((room) => room.id)) });
    if (callsOn) void callEngine.syncPendingInvites();
    return detach;
  }, [wsId, userId, callsOn]);

  useWSSubscriptions(
    (ws) => [
      ws.on("chat.voice.invite", (payload) => {
        if (callsOnRef.current) callEngine.onInvite(payload);
      }),
      ws.on("chat.voice.accept", (payload) => callEngine.onAccept(payload)),
      ws.on("chat.voice.hangup", (payload) => callEngine.onHangup(payload)),
      ws.onReconnect(() => {
        if (callsOnRef.current) void callEngine.syncPendingInvites();
      }),
    ],
    [],
  );
}
