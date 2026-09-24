"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useChatRooms, useChatVoiceToken } from "@uniwork/core/chat";
import { useWorkspace } from "../layout/workspace-context";
import { useNativeVoiceCall } from "./use-native-voice-call";
import { prepareVideoCapture, prepareVoiceCapture } from "./voice-call-media";
import { VoiceCallOverlay, type VoiceCallKind } from "./voice-call-overlay";
import type { VoiceCallDeviceError, VoiceCallOverlayState } from "./voice-call-overlay-types";

type ChatVoiceCallContextValue = {
  voiceCall: VoiceCallOverlayState;
  /** Warms up the devices, then rings; every failure lands on the call panel. */
  startCall: (
    roomId: string,
    label: string,
    callKind: VoiceCallKind,
    options?: { withCamera?: boolean },
  ) => Promise<boolean>;
  acceptCall: () => Promise<boolean>;
  declineCall: () => Promise<void>;
  inCall: boolean;
};

const ChatVoiceCallContext = createContext<ChatVoiceCallContextValue | null>(null);

export function useChatVoiceCall(): ChatVoiceCallContextValue {
  const ctx = useContext(ChatVoiceCallContext);
  if (!ctx) {
    throw new Error("useChatVoiceCall must be used within ChatVoiceCallHost");
  }
  return ctx;
}

/**
 * Hosts the native chat voice/video call above workspace routes so a call
 * survives navigation (chat → tasks → …) and stays reachable for incoming
 * invites while the user is on another screen.
 */
export function ChatVoiceCallHost({ children }: { children: ReactNode }) {
  const { workspace, user } = useWorkspace();
  const workspaceId = workspace.id;
  const currentUserId = user.id;
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const allowedRoomIds = useMemo(
    () =>
      new Set(
        rooms
          .filter((room) => room.kind === "dm" || room.kind === "group" || room.kind === "channel")
          .map((room) => room.id),
      ),
    [rooms],
  );
  // mutateAsync is stable across renders; the mutation object is not.
  const { mutateAsync: mintVoiceTokenAsync } = useChatVoiceToken();
  const mintVoiceToken = useCallback(
    async (roomId: string, callId: string) => mintVoiceTokenAsync({ roomId, callId }),
    [mintVoiceTokenAsync],
  );
  const voice = useNativeVoiceCall({
    workspaceId,
    currentUserId,
    mintToken: mintVoiceToken,
    allowedRoomIds,
  });
  const { startCall: ringCall, acceptCall: answerCall, reportStartFailure } = voice;
  // A device that would not start while answering: the call keeps ringing
  // and the panel says which device and why, so answering again is the retry.
  const [acceptError, setAcceptError] = useState<{ callId: string; device: VoiceCallDeviceError } | null>(null);

  const startCall = useCallback(
    async (roomId: string, label: string, callKind: VoiceCallKind, options?: { withCamera?: boolean }) => {
      const withCamera = options?.withCamera ?? false;
      const target = { roomId, peerName: label, callKind, withCamera };
      const prep = withCamera ? await prepareVideoCapture() : await prepareVoiceCapture();
      if (!prep.ok) {
        reportStartFailure({ ...target, reason: "device", device: prep.device });
        return false;
      }
      try {
        return await ringCall(roomId, label, callKind, { withCamera });
      } catch (err) {
        reportStartFailure({ ...target, reason: "start_failed", error: err });
        return false;
      }
    },
    [ringCall, reportStartFailure],
  );

  const acceptCall = useCallback(async () => {
    const current = voice.voiceCall;
    if (current.status !== "incoming") return false;
    const prep = await prepareVoiceCapture();
    if (!prep.ok) {
      setAcceptError({ callId: current.callId, device: prep.device });
      return false;
    }
    setAcceptError(null);
    return answerCall();
  }, [voice.voiceCall, answerCall]);

  const retryEnded = useCallback(() => {
    const current = voice.voiceCall;
    if (current.status !== "ended") return;
    void startCall(current.roomId, current.peerName, current.callKind, {
      withCamera: current.withCamera ?? false,
    });
  }, [voice.voiceCall, startCall]);

  const value = useMemo<ChatVoiceCallContextValue>(
    () => ({
      voiceCall: voice.voiceCall,
      startCall,
      acceptCall,
      declineCall: voice.declineCall,
      inCall: voice.inCall,
    }),
    [voice.voiceCall, voice.declineCall, voice.inCall, startCall, acceptCall],
  );

  const incomingDeviceError =
    acceptError && voice.voiceCall.status === "incoming" && voice.voiceCall.callId === acceptError.callId
      ? acceptError.device
      : null;

  return (
    <ChatVoiceCallContext.Provider value={value}>
      {children}
      <VoiceCallOverlay
        workspaceId={workspaceId}
        state={voice.voiceCall}
        incomingDeviceError={incomingDeviceError}
        onAccept={() => void acceptCall()}
        onDecline={() => void voice.declineCall()}
        onLeave={voice.leaveCall}
        onDisconnected={voice.finalizeCallOnDisconnect}
        onEndForAll={(init) => void voice.endCallForAll(init)}
        onConnected={voice.markVoiceConnected}
        onRetryEnded={retryEnded}
        onDismissEnded={voice.dismissEnded}
      />
    </ChatVoiceCallContext.Provider>
  );
}
