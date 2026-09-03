"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  signalChatVoiceAccept,
  signalChatVoiceHangup,
  signalChatVoiceInvite,
} from "@uniwork/core/api/endpoints/chat";
import { createVoiceCallId } from "@uniwork/core/chat/voice-call";
import { useOptionalWS } from "@uniwork/core/realtime";
import type { VoiceCallKind, VoiceCallOverlayState } from "./voice-call-overlay";

type MintVoiceToken = (
  roomId: string,
  callId: string,
) => Promise<{ token: string; url: string } | null>;

function voiceEventForUser(
  data: {
    room_id?: string;
    call_kind?: string;
    target_user_id?: string;
  },
  currentUserId: string,
  allowedRoomIds: ReadonlySet<string>,
): boolean {
  if (!data.room_id) return false;
  if (data.call_kind === "group") {
    return allowedRoomIds.has(data.room_id);
  }
  if (data.target_user_id) {
    return data.target_user_id === currentUserId;
  }
  return allowedRoomIds.has(data.room_id);
}

export function useNativeVoiceCall({
  workspaceId,
  currentUserId,
  mintToken,
  allowedRoomIds,
}: {
  workspaceId: string;
  currentUserId: string;
  mintToken: MintVoiceToken;
  allowedRoomIds: ReadonlySet<string>;
}) {
  const ws = useOptionalWS()?.client ?? null;
  const [state, setState] = useState<VoiceCallOverlayState>({ status: "idle" });
  const stateRef = useRef(state);
  const hangupSentRef = useRef<string | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  stateRef.current = state;

  const allowedRoomsKey = useMemo(() => [...allowedRoomIds].sort().join(","), [allowedRoomIds]);

  const markVoiceConnected = useCallback(() => {
    if (connectedAtRef.current == null) {
      connectedAtRef.current = Date.now();
    }
  }, []);

  const resetCallLocal = useCallback(() => {
    connectedAtRef.current = null;
    setState({ status: "idle" });
  }, []);

  const endCallForAll = useCallback(async () => {
    const current = stateRef.current;
    if (current.status === "idle") return;
    const { callId, roomId } = current;
    let durationSeconds: number | undefined;
    if (connectedAtRef.current != null) {
      durationSeconds = Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }
    resetCallLocal();
    if (hangupSentRef.current === callId) return;
    hangupSentRef.current = callId;
    try {
      await signalChatVoiceHangup(workspaceId, roomId, callId, durationSeconds);
    } catch {
      hangupSentRef.current = null;
    }
  }, [workspaceId, resetCallLocal]);

  const leaveCall = useCallback(() => {
    if (stateRef.current.status === "idle") return;
    resetCallLocal();
  }, [resetCallLocal]);

  const connectCall = useCallback(
    async (
      roomId: string,
      callId: string,
      peerName: string,
      outgoing: boolean,
      callKind: VoiceCallKind,
      callerName?: string,
    ) => {
      const connectingState = {
        status: "connecting" as const,
        callId,
        roomId,
        peerName,
        outgoing,
        callKind,
        callerName,
      };
      stateRef.current = connectingState;
      setState(connectingState);

      const creds = await mintToken(roomId, callId);
      const latest = stateRef.current;
      if (
        latest.status !== "connecting" ||
        latest.callId !== callId ||
        latest.roomId !== roomId
      ) {
        return false;
      }
      if (!creds) {
        resetCallLocal();
        return false;
      }
      const activeState = {
        status: "active" as const,
        callId,
        roomId,
        peerName,
        token: creds.token,
        url: creds.url,
        outgoing,
        callKind,
        callerName,
      };
      stateRef.current = activeState;
      setState(activeState);
      return true;
    },
    [mintToken, resetCallLocal],
  );

  useEffect(() => {
    if (!ws) return;

    const offInvite = ws.on("chat.voice.invite", (payload) => {
      const data = payload as {
        room_id?: string;
        call_id?: string;
        caller_id?: string;
        caller_name?: string;
        target_user_id?: string;
        call_kind?: string;
        room_name?: string;
      };
      if (!data.room_id || !data.call_id || !data.caller_id || data.caller_id === currentUserId) return;
      if (!voiceEventForUser(data, currentUserId, allowedRoomIds)) return;

      const callKind: VoiceCallKind = data.call_kind === "group" ? "group" : "dm";
      const peerName =
        callKind === "group"
          ? data.room_name?.trim() || data.caller_name?.trim() || data.caller_id
          : data.caller_name?.trim() || data.caller_id;
      const callerName = data.caller_name?.trim() || data.caller_id;

      setState((current) => {
        if (current.status === "active" || current.status === "ringing") return current;
        if (current.status === "incoming" && current.callId === data.call_id) return current;
        return {
          status: "incoming",
          callId: data.call_id!,
          roomId: data.room_id!,
          peerName,
          callKind,
          callerName: callKind === "group" ? callerName : undefined,
        };
      });
    });

    const offAccept = ws.on("chat.voice.accept", (payload) => {
      const data = payload as {
        room_id?: string;
        call_id?: string;
        user_id?: string;
        target_user_id?: string;
        call_kind?: string;
      };
      if (!data.room_id || !data.call_id || data.user_id === currentUserId) return;
      if (data.call_kind === "group") return;
      if (!voiceEventForUser(data, currentUserId, allowedRoomIds)) return;
      const current = stateRef.current;
      if (current.status !== "ringing" || current.callKind !== "dm") return;
      if (current.callId !== data.call_id || current.roomId !== data.room_id) return;
      void connectCall(current.roomId, current.callId, current.peerName, true, "dm");
    });

    const offHangup = ws.on("chat.voice.hangup", (payload) => {
      const data = payload as {
        room_id?: string;
        call_id?: string;
        user_id?: string;
        target_user_id?: string;
        call_kind?: string;
      };
      if (!data.room_id || !data.call_id) return;
      if (data.user_id === currentUserId) return;
      if (!voiceEventForUser(data, currentUserId, allowedRoomIds)) return;
      setState((current) => {
        if (current.status === "idle") return current;
        if (current.callId !== data.call_id || current.roomId !== data.room_id) return current;
        connectedAtRef.current = null;
        return { status: "idle" };
      });
    });

    return () => {
      offInvite();
      offAccept();
      offHangup();
    };
  }, [ws, currentUserId, connectCall, allowedRoomsKey, allowedRoomIds]);

  const startCall = useCallback(
    async (roomId: string, peerName: string, callKind: VoiceCallKind) => {
      if (stateRef.current.status !== "idle") return false;
      const callId = createVoiceCallId();
      hangupSentRef.current = null;
      await signalChatVoiceInvite(workspaceId, roomId, callId);
      if (callKind === "group") {
        return connectCall(roomId, callId, peerName, true, "group");
      }
      setState({
        status: "ringing",
        callId,
        roomId,
        peerName,
        outgoing: true,
        callKind: "dm",
      });
      return true;
    },
    [workspaceId, connectCall],
  );

  const acceptCall = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "incoming") return false;
    const { callId, roomId, peerName, callKind, callerName } = current;
    const connectingState = {
      status: "connecting" as const,
      callId,
      roomId,
      peerName,
      outgoing: false as const,
      callKind,
      callerName,
    };
    stateRef.current = connectingState;
    setState(connectingState);
    await signalChatVoiceAccept(workspaceId, roomId, callId);
    return connectCall(roomId, callId, peerName, false, callKind, callerName);
  }, [workspaceId, connectCall]);

  const declineCall = useCallback(async () => {
    const current = stateRef.current;
    if (current.status === "idle") return;
    if (current.callKind === "group") {
      leaveCall();
      return;
    }
    await endCallForAll();
  }, [leaveCall, endCallForAll]);

  return {
    voiceCall: state,
    startCall,
    acceptCall,
    declineCall,
    leaveCall,
    endCallForAll,
    markVoiceConnected,
    inCall: state.status !== "idle",
  };
}
