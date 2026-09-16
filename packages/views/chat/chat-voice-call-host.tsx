"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api/http";
import { useChatRooms, useChatVoiceToken } from "@uniwork/core/chat";
import { useWorkspace } from "../layout/workspace-context";
import { useNativeVoiceCall } from "./use-native-voice-call";
import { prepareVoiceCapture } from "./voice-call-media";
import { VoiceCallOverlay, type VoiceCallKind } from "./voice-call-overlay";
import type { VoiceCallOverlayState } from "./voice-call-overlay-types";

type ChatVoiceCallContextValue = {
  voiceCall: VoiceCallOverlayState;
  startCall: (
    roomId: string,
    label: string,
    callKind: VoiceCallKind,
    options?: { withCamera?: boolean },
  ) => Promise<boolean>;
  acceptCall: () => Promise<boolean>;
  declineCall: () => Promise<void>;
  leaveCall: () => void;
  endCallForAll: () => Promise<void>;
  finalizeCallOnDisconnect: () => void;
  markVoiceConnected: () => void;
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
  const { t } = useTranslation();
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
  const chatVoiceToken = useChatVoiceToken();
  const mintVoiceToken = useCallback(
    async (roomId: string, callId: string) => chatVoiceToken.mutateAsync({ roomId, callId }),
    [chatVoiceToken],
  );
  const voice = useNativeVoiceCall({
    workspaceId,
    currentUserId,
    mintToken: mintVoiceToken,
    allowedRoomIds,
  });

  const handleAccept = useCallback(async () => {
    try {
      const micReady = await prepareVoiceCapture();
      if (!micReady) {
        toast.error(t("chat.voice_call_mic_denied"));
        return;
      }
      const ok = await voice.acceptCall();
      if (!ok) toast.error(t("chat.voice_call_failed"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "livekit_not_configured") {
        toast.error(t("chat.voice_call_not_configured"));
      } else {
        toast.error(t("chat.voice_call_failed"));
      }
      void voice.declineCall();
    }
  }, [voice, t]);

  const value = useMemo<ChatVoiceCallContextValue>(
    () => ({
      voiceCall: voice.voiceCall,
      startCall: voice.startCall,
      acceptCall: voice.acceptCall,
      declineCall: voice.declineCall,
      leaveCall: voice.leaveCall,
      endCallForAll: voice.endCallForAll,
      finalizeCallOnDisconnect: voice.finalizeCallOnDisconnect,
      markVoiceConnected: voice.markVoiceConnected,
      inCall: voice.inCall,
    }),
    [voice],
  );

  return (
    <ChatVoiceCallContext.Provider value={value}>
      {children}
      <VoiceCallOverlay
        workspaceId={workspaceId}
        state={voice.voiceCall}
        onAccept={() => void handleAccept()}
        onDecline={() => void voice.declineCall()}
        onLeave={voice.leaveCall}
        onDisconnected={voice.finalizeCallOnDisconnect}
        onEndForAll={() => void voice.endCallForAll()}
        onConnected={voice.markVoiceConnected}
      />
    </ChatVoiceCallContext.Provider>
  );
}
