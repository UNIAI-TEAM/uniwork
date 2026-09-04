"use client";
import { useChat } from "@livekit/components-react";
import { useEffect, useMemo, useState } from "react";
import {
  mergeLiveChatArchive,
  toEphemeralChatItems,
  type LiveChatMessage,
  type MeetingChatItem,
} from "./meeting-chat";

/** LiveKit-only chat when Postgres APIs are unavailable (guest / offline). */
export function useEphemeralMeetingRoomChat() {
  const { chatMessages, send: livekitSend, isSending } = useChat();
  const [liveArchive, setLiveArchive] = useState<LiveChatMessage[]>([]);

  const liveItems: LiveChatMessage[] = useMemo(
    () =>
      chatMessages.map((msg) => ({
        id: msg.id ?? `${msg.from?.identity ?? "x"}-${msg.timestamp}-${msg.message}`,
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
    () => toEphemeralChatItems(mergedLive),
    [mergedLive],
  );

  return {
    items,
    send: async (message: string) => {
      await livekitSend(message);
    },
    isSending,
  };
}
