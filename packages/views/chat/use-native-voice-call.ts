"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listPendingChatVoiceInvites,
  signalChatVoiceAccept,
  signalChatVoiceHangup,
  signalChatVoiceInvite,
} from "@uniwork/core/api/endpoints/chat";
import { createVoiceCallId } from "@uniwork/core/chat/voice-call";
import { useOptionalWS } from "@uniwork/core/realtime";
import type { VoiceCallKind, VoiceCallOverlayState } from "./voice-call-overlay";
import { isMultiPartyVoiceCall, voiceCallKindFromServer } from "./voice-call-kind-utils";

type MintVoiceToken = (
  roomId: string,
  callId: string,
) => Promise<{ token: string; url: string } | null>;

type VoiceInvitePayload = {
  room_id?: string;
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  target_user_id?: string;
  call_kind?: string;
  room_name?: string;
};

function voiceEventForUser(
  data: VoiceInvitePayload,
  currentUserId: string,
  allowedRoomIds: ReadonlySet<string>,
): boolean {
  if (!data.room_id) return false;
  if (isMultiPartyVoiceCall(data.call_kind)) {
    return allowedRoomIds.has(data.room_id);
  }
  if (data.target_user_id) {
    return data.target_user_id === currentUserId;
  }
  return allowedRoomIds.has(data.room_id);
}

function incomingStateFromInvite(data: VoiceInvitePayload): VoiceCallOverlayState | null {
  if (!data.room_id || !data.call_id || !data.caller_id) return null;
  const callKind = voiceCallKindFromServer(data.call_kind);
  const peerName = isMultiPartyVoiceCall(callKind)
    ? data.room_name?.trim() || data.caller_name?.trim() || data.caller_id
    : data.caller_name?.trim() || data.caller_id;
  const callerName = data.caller_name?.trim() || data.caller_id;
  return {
    status: "incoming",
    callId: data.call_id,
    roomId: data.room_id,
    peerName,
    callKind,
    callerName: isMultiPartyVoiceCall(callKind) ? callerName : undefined,
  };
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

  const applyIncomingInvite = useCallback(
    (data: VoiceInvitePayload, options?: { skipRoomCheck?: boolean }) => {
      if (!data.room_id || !data.call_id || !data.caller_id || data.caller_id === currentUserId) {
        return;
      }
      if (!options?.skipRoomCheck && !voiceEventForUser(data, currentUserId, allowedRoomIds)) {
        return;
      }
      const incoming = incomingStateFromInvite(data);
      if (!incoming || incoming.status !== "incoming") return;
      setState((current) => {
        if (current.status === "active" || current.status === "ringing") return current;
        if (current.status === "incoming" && current.callId === incoming.callId) return current;
        return incoming;
      });
    },
    [allowedRoomIds, currentUserId],
  );

  const syncPendingInvites = useCallback(async () => {
    if (stateRef.current.status !== "idle") return;
    try {
      const invites = await listPendingChatVoiceInvites(workspaceId);
      if (invites.length === 0) return;
      const latest = [...invites].sort(
        (a, b) => Date.parse(b.invited_at) - Date.parse(a.invited_at),
      )[0];
      if (!latest) return;
      applyIncomingInvite(
        {
          room_id: latest.room_id,
          call_id: latest.call_id,
          caller_id: latest.caller_id,
          caller_name: latest.caller_name,
          call_kind: latest.call_kind,
          room_name: latest.room_name,
        },
        { skipRoomCheck: true },
      );
    } catch {
      // Best-effort recovery when realtime invite was missed.
    }
  }, [applyIncomingInvite, workspaceId]);

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
    if (hangupSentRef.current === callId) {
      resetCallLocal();
      return;
    }
    hangupSentRef.current = callId;
    try {
      await signalChatVoiceHangup(workspaceId, roomId, callId, durationSeconds);
    } catch {
      hangupSentRef.current = null;
    } finally {
      resetCallLocal();
    }
  }, [workspaceId, resetCallLocal]);

  const leaveCall = useCallback(() => {
    if (stateRef.current.status === "idle") return;
    resetCallLocal();
  }, [resetCallLocal]);

  const finalizeCallOnDisconnect = useCallback(() => {
    const current = stateRef.current;
    if (current.status === "idle") return;
    if (hangupSentRef.current === current.callId) {
      resetCallLocal();
      return;
    }
    if (current.callKind === "dm") {
      void endCallForAll();
      return;
    }
    if (
      current.status === "ringing" ||
      ((current.status === "connecting" || current.status === "active") && current.outgoing)
    ) {
      void endCallForAll();
      return;
    }
    resetCallLocal();
  }, [endCallForAll, resetCallLocal]);

  const connectCall = useCallback(
    async (
      roomId: string,
      callId: string,
      peerName: string,
      outgoing: boolean,
      callKind: VoiceCallKind,
      callerName?: string,
      withCamera = false,
    ) => {
      const connectingState = {
        status: "connecting" as const,
        callId,
        roomId,
        peerName,
        outgoing,
        callKind,
        callerName,
        withCamera,
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
        withCamera,
      };
      stateRef.current = activeState;
      setState(activeState);
      return true;
    },
    [mintToken, resetCallLocal],
  );

  useEffect(() => {
    void syncPendingInvites();
  }, [syncPendingInvites, allowedRoomsKey]);

  useEffect(() => {
    if (!ws) return;
    return ws.onReconnect(() => {
      void syncPendingInvites();
    });
  }, [ws, syncPendingInvites]);

  useEffect(() => {
    if (!ws) return;

    const offInvite = ws.on("chat.voice.invite", (payload) => {
      applyIncomingInvite(payload as VoiceInvitePayload);
    });

    const offAccept = ws.on("chat.voice.accept", (payload) => {
      const data = payload as VoiceInvitePayload & { user_id?: string };
      if (!data.room_id || !data.call_id || data.user_id === currentUserId) return;
      if (isMultiPartyVoiceCall(data.call_kind)) return;
      if (!voiceEventForUser(data, currentUserId, allowedRoomIds)) return;
      const current = stateRef.current;
      if (current.status !== "ringing" || current.callKind !== "dm") return;
      if (current.callId !== data.call_id || current.roomId !== data.room_id) return;
      void connectCall(
        current.roomId,
        current.callId,
        current.peerName,
        true,
        "dm",
        undefined,
        current.withCamera ?? false,
      );
    });

    const offHangup = ws.on("chat.voice.hangup", (payload) => {
      const data = payload as VoiceInvitePayload & { user_id?: string };
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
  }, [ws, currentUserId, connectCall, allowedRoomsKey, allowedRoomIds, applyIncomingInvite]);

  const startCall = useCallback(
    async (
      roomId: string,
      peerName: string,
      callKind: VoiceCallKind,
      options?: { withCamera?: boolean },
    ) => {
      if (stateRef.current.status !== "idle") return false;
      const withCamera = options?.withCamera ?? false;
      const callId = createVoiceCallId();
      hangupSentRef.current = null;
      await signalChatVoiceInvite(workspaceId, roomId, callId);
      if (isMultiPartyVoiceCall(callKind)) {
        return connectCall(roomId, callId, peerName, true, callKind, undefined, withCamera);
      }
      setState({
        status: "ringing",
        callId,
        roomId,
        peerName,
        outgoing: true,
        callKind: "dm",
        withCamera,
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
    if (isMultiPartyVoiceCall(current.callKind)) {
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
    finalizeCallOnDisconnect,
    markVoiceConnected,
    inCall: state.status !== "idle",
  };
}
