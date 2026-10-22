// Layer 3 of the realtime stack for calls (spec cha §8: chat.voice.* → the call
// overlay): hands the user-scope call frames to the call engine, and asks for
// the invites still ringing when the workspace opens and after every
// reconnect, as the web's use-native-voice-call does. With the server's calls
// switch off (data/remote-config.ts) nothing rings: invites are not handed on
// and none are asked for; a call already under way keeps its workspace
// context and still hears its accept and hang-up, so turning the switch off
// never ends or strands one (use-call-realtime.test.tsx). A return to the
// foreground and every reconnect reconcile the call with the server:
// a ring the server no longer lists stops, a call ringing now is picked up.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { callEngine, onHangupSettled } from "@/data/calls/call-store";
import { chatKeys } from "@/data/queries/chat-keys";
import { roomsOptions } from "@/data/queries/chat";
import { useMobileFlag } from "@/data/remote-config";
import { useWSSubscriptions } from "@/data/realtime/use-ws-subscriptions";

export function useCallRealtime(wsId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: rooms } = useQuery(roomsOptions(wsId));
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const callsOnRef = useRef(callsOn);
  callsOnRef.current = callsOn;

  // The workspace's context, keyed on who and where only: detaching the last
  // one ends the call here, so a change of the switch must never re-run it.
  useEffect(() => {
    if (!userId) return;
    return callEngine.attach({ wsId, userId, allowedRoomIds: () => new Set((roomsRef.current ?? []).map((room) => room.id)) });
  }, [wsId, userId]);

  // A hangup this phone sent has its log written by the time the server answers; another's arrives as
  // chat.voice.hangup (data/realtime/chat-realtime.ts). Either way the calls tab refetches.
  useEffect(() => onHangupSettled((callWsId) => void qc.invalidateQueries({ queryKey: chatKeys.callLogs(callWsId) })), [qc]);

  // Runs after the attach above (effects run in order), and again when the switch comes back on.
  useEffect(() => {
    if (userId && callsOn) void callEngine.syncPendingInvites();
  }, [wsId, userId, callsOn]);

  // Frames sent while the app was in the background may be gone: check with the server on the way back.
  useEffect(() => {
    if (!userId) return;
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active" && previous === "background") void callEngine.reconcile({ ring: callsOnRef.current });
      previous = status;
    });
    return () => sub.remove();
  }, [userId]);

  useWSSubscriptions(
    (ws) => [
      ws.on("chat.voice.invite", (payload) => {
        if (callsOnRef.current) callEngine.onInvite(payload);
      }),
      ws.on("chat.voice.accept", (payload) => callEngine.onAccept(payload)),
      ws.on("chat.voice.hangup", (payload) => callEngine.onHangup(payload)),
      ws.onReconnect(() => void callEngine.reconcile({ ring: callsOnRef.current })),
    ],
    [],
  );
}
