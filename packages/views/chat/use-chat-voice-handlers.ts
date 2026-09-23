"use client";

import { useCallback } from "react";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { VoiceCallKind } from "./voice-call-overlay";

/**
 * The chat header's call buttons. Device warm-up and every failure (a
 * blocked mic, a server that refuses) belong to the call host, which shows
 * them on the call panel with a retry, so this only names the call.
 */
export function useChatVoiceHandlers({
  targetKind,
  activeRoomId,
  activeContact,
  activeGroup,
  activeChannel = null,
  startCall,
  acceptCall,
  declineCall,
}: {
  targetKind: "workspace" | "dm" | "group" | "channel";
  activeRoomId: string | null;
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  activeChannel?: { name: string } | null;
  startCall: (
    roomId: string,
    label: string,
    callKind: VoiceCallKind,
    options?: { withCamera?: boolean },
  ) => Promise<boolean>;
  acceptCall: () => Promise<boolean>;
  declineCall: () => void | Promise<void>;
}) {
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
      } else if (targetKind === "channel") {
        if (!activeChannel) return;
        label = `#${activeChannel.name}`;
        callKind = "channel";
      }
      if (!label || !callKind) return;
      await startCall(activeRoomId, label, callKind, { withCamera });
    },
    [targetKind, activeRoomId, activeContact, activeGroup, activeChannel, startCall],
  );

  const handleStartVoiceCall = useCallback(async () => {
    await handleStartCall(false);
  }, [handleStartCall]);

  const handleStartVideoCall = useCallback(async () => {
    await handleStartCall(true);
  }, [handleStartCall]);

  const handleAcceptVoiceCall = useCallback(async () => {
    try {
      await acceptCall();
    } catch {
      // The host reports accept failures on the panel; an unexpected throw
      // must still not leave the caller ringing.
      await declineCall();
    }
  }, [acceptCall, declineCall]);

  return { handleStartVoiceCall, handleStartVideoCall, handleAcceptVoiceCall };
}
