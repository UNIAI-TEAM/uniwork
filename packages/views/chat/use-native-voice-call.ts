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
import {
  incomingStateFromInvite,
  latestRingingInvite,
  voiceEventForUser,
  type VoiceInvitePayload,
} from "./voice-call-invites";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";
import {
  VOICE_CALL_CONNECTING_TIMEOUT_MS,
  VOICE_CALL_ENDED_DISMISS_MS,
  VOICE_CALL_RING_TIMEOUT_MS,
  isInformationalEnd,
  type VoiceCallDisconnectInfo,
  type VoiceCallEndInit,
  type VoiceCallEndedState,
  type VoiceCallKind,
  type VoiceCallOverlayState,
} from "./voice-call-overlay-types";

type MintVoiceToken = (
  roomId: string,
  callId: string,
) => Promise<{ token: string; url: string } | null>;

type LiveCallState = Exclude<VoiceCallOverlayState, { status: "idle" } | { status: "ended" }>;

function isLive(state: VoiceCallOverlayState): state is LiveCallState {
  return state.status !== "idle" && state.status !== "ended";
}

/**
 * Whether leaving this call must tell the server (and so the others): a 1-1
 * call ends for both, a ringing call stops ringing, and the person who
 * started a group call closes it. Anyone else in a group call just leaves.
 */
function leavingSignalsHangup(state: LiveCallState): boolean {
  if (state.callKind === "dm" || state.status === "ringing") return true;
  return state.status !== "incoming" && state.outgoing && isMultiPartyVoiceCall(state.callKind);
}

function endedFrom(state: LiveCallState, init: VoiceCallEndInit): VoiceCallEndedState {
  return {
    status: "ended",
    reason: init.reason,
    error: init.error,
    device: init.device,
    callId: state.callId,
    roomId: state.roomId,
    peerName: state.peerName,
    callKind: state.callKind,
    outgoing: state.status === "incoming" ? false : state.outgoing,
    withCamera: state.status === "incoming" ? undefined : state.withCamera,
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
  // Calls that already rang out, were declined or ended here: a late
  // realtime frame or the pending-invite sync must not ring them again.
  const closedCallIdsRef = useRef(new Set<string>());
  const mintTokenRef = useRef(mintToken);
  const allowedRoomIdsRef = useRef(allowedRoomIds);
  mintTokenRef.current = mintToken;
  allowedRoomIdsRef.current = allowedRoomIds;

  const allowedRoomsKey = useMemo(() => [...allowedRoomIds].sort().join(","), [allowedRoomIds]);

  const setCallState = useCallback((next: VoiceCallOverlayState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Closes the local call: to idle, or to an ended panel that says why. */
  const closeLocal = useCallback(
    (init?: VoiceCallEndInit) => {
      const current = stateRef.current;
      connectedAtRef.current = null;
      if (!isLive(current)) {
        if (current.status === "ended" && !init) setCallState({ status: "idle" });
        return;
      }
      closedCallIdsRef.current.add(current.callId);
      setCallState(init ? endedFrom(current, init) : { status: "idle" });
    },
    [setCallState],
  );

  const endCallForAll = useCallback(
    async (init?: VoiceCallEndInit) => {
      const current = stateRef.current;
      if (!isLive(current)) {
        closeLocal();
        return;
      }
      const { callId, roomId } = current;
      let durationSeconds: number | undefined;
      if (connectedAtRef.current != null) {
        durationSeconds = Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000));
      }
      // The call closes on screen at once; the hangup signal is best effort.
      closeLocal(init);
      if (hangupSentRef.current === callId) return;
      hangupSentRef.current = callId;
      try {
        await signalChatVoiceHangup(workspaceId, roomId, callId, durationSeconds);
      } catch {
        hangupSentRef.current = null;
      }
    },
    [workspaceId, closeLocal],
  );

  const leaveCall = useCallback(
    (init?: VoiceCallEndInit) => {
      closeLocal(init);
    },
    [closeLocal],
  );

  /** Ends the current call the way its kind requires, with a reason on screen. */
  const failCall = useCallback(
    async (init: VoiceCallEndInit) => {
      const current = stateRef.current;
      if (!isLive(current)) return;
      if (leavingSignalsHangup(current)) {
        await endCallForAll(init);
        return;
      }
      closeLocal(init);
    },
    [endCallForAll, closeLocal],
  );

  const finalizeCallOnDisconnect = useCallback((info?: VoiceCallDisconnectInfo) => {
    const current = stateRef.current;
    if (!isLive(current)) return;
    if (hangupSentRef.current === current.callId || info?.movedElsewhere) {
      closeLocal();
      return;
    }
    void failCall({ reason: "peer_ended" });
  }, [closeLocal, failCall]);

  const declineBusyInvite = useCallback(
    (roomId: string, callId: string, callKind: VoiceCallKind) => {
      closedCallIdsRef.current.add(callId);
      // A group call keeps going without us; only a 1-1 caller would be left ringing.
      if (isMultiPartyVoiceCall(callKind)) return;
      void signalChatVoiceHangup(workspaceId, roomId, callId).catch(() => undefined);
    },
    [workspaceId],
  );

  const applyIncomingInvite = useCallback(
    (data: VoiceInvitePayload, options?: { skipRoomCheck?: boolean }) => {
      if (!data.room_id || !data.call_id || !data.caller_id || data.caller_id === currentUserId) {
        return;
      }
      if (closedCallIdsRef.current.has(data.call_id)) return;
      if (
        !options?.skipRoomCheck &&
        !voiceEventForUser(data, currentUserId, allowedRoomIdsRef.current)
      ) {
        return;
      }
      const incoming = incomingStateFromInvite(data);
      if (!incoming) return;
      const current = stateRef.current;
      if (isLive(current)) {
        if (current.callId === incoming.callId) return;
        // Already on (or answering, or ringing for) another call: say "busy"
        // right away instead of letting the second caller ring out.
        declineBusyInvite(incoming.roomId, incoming.callId, incoming.callKind);
        return;
      }
      hangupSentRef.current = null;
      setCallState(incoming);
    },
    [currentUserId, declineBusyInvite, setCallState],
  );

  const syncPendingInvites = useCallback(async () => {
    if (isLive(stateRef.current)) return;
    try {
      const invites = await listPendingChatVoiceInvites(workspaceId);
      const latest = latestRingingInvite(invites);
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
      setCallState({
        status: "connecting",
        callId,
        roomId,
        peerName,
        outgoing,
        callKind,
        callerName,
        withCamera,
      });
      const stillConnecting = () => {
        const latest = stateRef.current;
        return latest.status === "connecting" && latest.callId === callId && latest.roomId === roomId;
      };
      let creds: { token: string; url: string } | null;
      try {
        creds = await mintTokenRef.current(roomId, callId);
      } catch (err) {
        if (stillConnecting()) await failCall({ reason: "connect_failed", error: err });
        return false;
      }
      if (!stillConnecting()) return false;
      if (!creds) {
        await failCall({ reason: "connect_failed" });
        return false;
      }
      setCallState({
        status: "active",
        callId,
        roomId,
        peerName,
        token: creds.token,
        url: creds.url,
        outgoing,
        callKind,
        callerName,
        withCamera,
      });
      return true;
    },
    [failCall, setCallState],
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
      if (!voiceEventForUser(data, currentUserId, allowedRoomIdsRef.current)) return;
      const current = stateRef.current;
      if (current.status !== "ringing" || current.callKind !== "dm") return;
      if (current.callId !== data.call_id || current.roomId !== data.room_id) return;
      // connectCall owns its failures (hang up + reason on the panel).
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
      if (!voiceEventForUser(data, currentUserId, allowedRoomIdsRef.current)) return;
      closedCallIdsRef.current.add(data.call_id);
      const current = stateRef.current;
      if (!isLive(current)) return;
      if (current.callId !== data.call_id || current.roomId !== data.room_id) return;
      hangupSentRef.current = current.callId;
      const reason =
        current.status === "incoming" ? "missed" : current.status === "ringing" ? "declined" : "peer_ended";
      closeLocal({ reason });
    });

    return () => {
      offInvite();
      offAccept();
      offHangup();
    };
  }, [ws, currentUserId, connectCall, applyIncomingInvite, closeLocal]);

  // Ring, connect and "ended" panels all run on a clock, not forever.
  useEffect(() => {
    if (state.status === "idle") return;
    const callId = state.status === "ended" ? undefined : state.callId;
    const sameCall = () => {
      const latest = stateRef.current;
      return latest.status === state.status && (latest.status === "ended" || latest.callId === callId);
    };
    let delay: number;
    let onTimeout: () => void;
    switch (state.status) {
      case "ringing":
        delay = VOICE_CALL_RING_TIMEOUT_MS;
        onTimeout = () => void endCallForAll({ reason: "no_answer" });
        break;
      case "incoming":
        delay = VOICE_CALL_RING_TIMEOUT_MS;
        onTimeout = () => closeLocal({ reason: "missed" });
        break;
      case "connecting":
        delay = VOICE_CALL_CONNECTING_TIMEOUT_MS;
        onTimeout = () => void failCall({ reason: "connect_failed" });
        break;
      case "ended":
        if (!isInformationalEnd(state.reason)) return;
        delay = VOICE_CALL_ENDED_DISMISS_MS;
        onTimeout = () => setCallState({ status: "idle" });
        break;
      default:
        return;
    }
    const timer = setTimeout(() => {
      if (sameCall()) onTimeout();
    }, delay);
    return () => clearTimeout(timer);
  }, [state, endCallForAll, closeLocal, failCall, setCallState]);

  const startCall = useCallback(
    async (
      roomId: string,
      peerName: string,
      callKind: VoiceCallKind,
      options?: { withCamera?: boolean },
    ) => {
      if (isLive(stateRef.current)) return false;
      const withCamera = options?.withCamera ?? false;
      const callId = createVoiceCallId();
      hangupSentRef.current = null;
      await signalChatVoiceInvite(workspaceId, roomId, callId);
      if (isMultiPartyVoiceCall(callKind)) {
        return connectCall(roomId, callId, peerName, true, callKind, undefined, withCamera);
      }
      setCallState({
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
    [workspaceId, connectCall, setCallState],
  );

  const acceptCall = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "incoming") return false;
    const { callId, roomId, peerName, callKind, callerName } = current;
    setCallState({
      status: "connecting",
      callId,
      roomId,
      peerName,
      outgoing: false,
      callKind,
      callerName,
    });
    try {
      await signalChatVoiceAccept(workspaceId, roomId, callId);
    } catch (err) {
      const latest = stateRef.current;
      if (latest.status === "connecting" && latest.callId === callId) {
        await failCall({ reason: "connect_failed", error: err });
      }
      return false;
    }
    // The caller may have hung up while the accept was in flight.
    const latest = stateRef.current;
    if (latest.status !== "connecting" || latest.callId !== callId) return false;
    return connectCall(roomId, callId, peerName, false, callKind, callerName);
  }, [workspaceId, connectCall, failCall, setCallState]);

  const declineCall = useCallback(async () => {
    const current = stateRef.current;
    if (!isLive(current)) {
      closeLocal();
      return;
    }
    if (isMultiPartyVoiceCall(current.callKind)) {
      leaveCall();
      return;
    }
    await endCallForAll();
  }, [closeLocal, leaveCall, endCallForAll]);

  /** A call that never started (device, invite error) still gets a panel that says why. */
  const reportStartFailure = useCallback(
    (failure: Omit<VoiceCallEndedState, "status" | "outgoing">) => {
      if (isLive(stateRef.current)) return;
      setCallState({ status: "ended", outgoing: true, ...failure });
    },
    [setCallState],
  );

  const dismissEnded = useCallback(() => {
    if (stateRef.current.status === "ended") setCallState({ status: "idle" });
  }, [setCallState]);

  const inCall = isLive(state);

  return useMemo(
    () => ({
      voiceCall: state,
      startCall,
      acceptCall,
      declineCall,
      leaveCall,
      endCallForAll,
      finalizeCallOnDisconnect,
      markVoiceConnected,
      reportStartFailure,
      dismissEnded,
      inCall,
    }),
    [
      state,
      startCall,
      acceptCall,
      declineCall,
      leaveCall,
      endCallForAll,
      finalizeCallOnDisconnect,
      markVoiceConnected,
      reportStartFailure,
      dismissEnded,
      inCall,
    ],
  );
}
