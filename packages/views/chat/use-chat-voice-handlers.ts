"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api/http";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { VoiceCallKind } from "./voice-call-overlay";
import { prepareVideoCapture, prepareVoiceCapture } from "./voice-call-media";

function voiceCallErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.code === "livekit_not_configured") return t("chat.voice_call_not_configured");
    if (err.code === "chat_user_blocked") return t("chat.voice_call_blocked");
  }
  return t("chat.voice_call_failed");
}

export function useChatVoiceHandlers({
  targetKind,
  activeRoomId,
  activeContact,
  activeGroup,
  startCall,
  acceptCall,
  declineCall,
}: {
  targetKind: "workspace" | "dm" | "group";
  activeRoomId: string | null;
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  startCall: (
    roomId: string,
    label: string,
    callKind: VoiceCallKind,
    options?: { withCamera?: boolean },
  ) => Promise<boolean>;
  acceptCall: () => Promise<boolean>;
  declineCall: () => void;
}) {
  const { t } = useTranslation();

  const handleStartCall = useCallback(
    async (withCamera: boolean) => {
      if (!activeRoomId) return;
      let label: string | null = null;
      let callKind: VoiceCallKind | null = null;
      if (targetKind === "dm") {
        if (!activeContact) return;
        label = displayLabelForChatContact(activeContact);
        callKind = "dm";
      } else if (targetKind === "group") {
        if (!activeGroup) return;
        label = activeGroup.name;
        callKind = "group";
      }
      if (!label || !callKind) return;
      try {
        const mediaReady = withCamera ? await prepareVideoCapture() : await prepareVoiceCapture();
        if (!mediaReady) {
          toast.error(withCamera ? t("chat.voice_call_camera_failed") : t("chat.voice_call_mic_denied"));
          return;
        }
        const ok = await startCall(activeRoomId, label, callKind, { withCamera });
        if (!ok) {
          toast.error(t("chat.voice_call_failed"));
        }
      } catch (err) {
        toast.error(voiceCallErrorMessage(err, t));
      }
    },
    [targetKind, activeRoomId, activeContact, activeGroup, startCall, t],
  );

  const handleStartVoiceCall = useCallback(async () => {
    await handleStartCall(false);
  }, [handleStartCall]);

  const handleStartVideoCall = useCallback(async () => {
    await handleStartCall(true);
  }, [handleStartCall]);

  const handleAcceptVoiceCall = useCallback(async () => {
    try {
      const micReady = await prepareVoiceCapture();
      if (!micReady) {
        toast.error(t("chat.voice_call_mic_denied"));
        return;
      }
      const ok = await acceptCall();
      if (!ok) toast.error(t("chat.voice_call_failed"));
    } catch (err) {
      toast.error(voiceCallErrorMessage(err, t));
      void declineCall();
    }
  }, [acceptCall, declineCall, t]);

  return { handleStartVoiceCall, handleStartVideoCall, handleAcceptVoiceCall };
}
