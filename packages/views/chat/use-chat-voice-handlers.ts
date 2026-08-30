"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api/http";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";

export function useChatVoiceHandlers({
  targetKind,
  activeRoomId,
  activeContact,
  startCall,
  acceptCall,
  declineCall,
}: {
  targetKind: "workspace" | "dm" | "group";
  activeRoomId: string | null;
  activeContact: ChatContact | null;
  startCall: (roomId: string, label: string) => Promise<boolean>;
  acceptCall: () => Promise<boolean>;
  declineCall: () => void;
}) {
  const { t } = useTranslation();

  const handleStartVoiceCall = useCallback(async () => {
    if (targetKind !== "dm" || !activeRoomId || !activeContact) return;
    try {
      const ok = await startCall(activeRoomId, displayLabelForChatContact(activeContact));
      if (!ok) {
        toast.error(t("chat.voice_call_failed"));
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "livekit_not_configured"
          ? t("chat.voice_call_not_configured")
          : t("chat.voice_call_failed");
      toast.error(msg);
    }
  }, [targetKind, activeRoomId, activeContact, startCall, t]);

  const handleAcceptVoiceCall = useCallback(async () => {
    try {
      const ok = await acceptCall();
      if (!ok) toast.error(t("chat.voice_call_failed"));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "livekit_not_configured"
          ? t("chat.voice_call_not_configured")
          : t("chat.voice_call_failed");
      toast.error(msg);
      void declineCall();
    }
  }, [acceptCall, declineCall, t]);

  return { handleStartVoiceCall, handleAcceptVoiceCall };
}
