"use client";
import { useChat, useLocalParticipant } from "@livekit/components-react";
import { useEffect, useMemo, useState } from "react";
import { useAppendMeetingChat, useMeetingChat } from "@uniwork/core/meetings";
import {
  mergeChatMessages,
  mergeLiveChatArchive,
  type LiveChatMessage,
  type MeetingChatItem,
} from "./meeting-chat";

export function useMeetingRoomChat(meetingId?: string) {
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant.identity;
  const { chatMessages, send: livekitSend, isSending: livekitSending } = useChat();
  const { data: persisted = [] } = useMeetingChat(meetingId ?? "", !!meetingId);
  const append = useAppendMeetingChat(meetingId ?? "");
  const [liveArchive, setLiveArchive] = useState<LiveChatMessage[]>([]);

  const liveItems: LiveChatMessage[] = useMemo(
    () =>
      chatMessages.map((msg) => ({
        id: `${msg.from?.identity ?? "x"}-${msg.timestamp}-${msg.message}`,
        fromIdentity: msg.from?.identity ?? "",
        fromName: msg.from?.name || msg.from?.identity || "",
        isLocal: Boolean(msg.from?.isLocal),
        message: msg.message,
        timestamp: msg.timestamp,
      })),
    [chatMessages],
  );

  useEffect(() => {
    setLiveArchive((prev) => mergeLiveChatArchive(prev, liveItems));
  }, [liveItems]);

  const mergedLive = useMemo(
    () => mergeLiveChatArchive(liveArchive, liveItems),
    [liveArchive, liveItems],
  );

  const items: MeetingChatItem[] = useMemo(
    () => mergeChatMessages(persisted, mergedLive, localIdentity),
    [persisted, mergedLive, localIdentity],
  );

  async function send(message: string) {
    if (meetingId) {
      try {
        await append.mutateAsync(message);
      } catch {
        // Guest or offline API — still deliver over LiveKit when possible.
      }
    }
    await livekitSend(message);
  }

  return {
    items,
    send,
    isSending: append.isPending || livekitSending,
  };
}
