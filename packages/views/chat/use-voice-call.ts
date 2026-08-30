"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { createVoiceCallId } from "@uniwork/core/chat/voice-call";
import {
  installVoiceCallListener,
  isDuplicateVoiceInvite,
  sendVoiceCallHangup,
  sendVoiceCallInvite,
} from "./matrix-voice-signaling";
import type { VoiceCallOverlayState } from "./voice-call-overlay";

type MintVoiceToken = (matrixRoomId: string) => Promise<{ token: string; url: string } | null>;

export function useVoiceCall({
  client,
  myMatrixUserId,
  mintToken,
}: {
  client: MatrixClient | null;
  myMatrixUserId: string | null;
  mintToken: MintVoiceToken;
}) {
  const [state, setState] = useState<VoiceCallOverlayState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;

  const endCall = useCallback(
    async (notifyPeer: boolean) => {
      const current = stateRef.current;
      if (current.status === "idle") return;
      if (notifyPeer && client) {
        await sendVoiceCallHangup(client, current.matrixRoomId, current.callId);
      }
      setState({ status: "idle" });
    },
    [client],
  );

  useEffect(() => {
    if (!client || !myMatrixUserId) return;

    return installVoiceCallListener(client, myMatrixUserId, {
      onInvite: (payload) => {
        setState((current) => {
          if (isDuplicateVoiceInvite(current, payload)) return current;
          if (current.status === "active") return current;
          return {
            status: "incoming",
            callId: payload.callId,
            matrixRoomId: payload.matrixRoomId,
            peerName: payload.peerName,
          };
        });
      },
      onHangup: (payload) => {
        setState((current) => {
          if (current.status === "idle") return current;
          if (current.callId !== payload.callId || current.matrixRoomId !== payload.matrixRoomId) {
            return current;
          }
          return { status: "idle" };
        });
      },
    });
  }, [client, myMatrixUserId]);

  const startCall = useCallback(
    async (matrixRoomId: string, peerName: string) => {
      if (!client || stateRef.current.status !== "idle") return false;
      const callId = createVoiceCallId();
      const creds = await mintToken(matrixRoomId);
      if (!creds) return false;
      await sendVoiceCallInvite(client, matrixRoomId, callId);
      setState({
        status: "active",
        callId,
        matrixRoomId,
        peerName,
        token: creds.token,
        url: creds.url,
        outgoing: true,
      });
      return true;
    },
    [client, mintToken],
  );

  const acceptCall = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "incoming" || !client) return false;
    const creds = await mintToken(current.matrixRoomId);
    if (!creds) return false;
    setState({
      status: "active",
      callId: current.callId,
      matrixRoomId: current.matrixRoomId,
      peerName: current.peerName,
      token: creds.token,
      url: creds.url,
      outgoing: false,
    });
    return true;
  }, [client, mintToken]);

  const declineCall = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "incoming") return;
    await endCall(true);
  }, [endCall]);

  const hangUp = useCallback(async () => {
    await endCall(true);
  }, [endCall]);

  return {
    voiceCall: state,
    startCall,
    acceptCall,
    declineCall,
    hangUp,
    inCall: state.status !== "idle",
  };
}
