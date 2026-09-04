"use client";
import { useLocalParticipant } from "@livekit/components-react";
import { useMemo } from "react";
import { useAppendMeetingChat, useMeetingChat } from "@uniwork/core/meetings";
import { toChatItems, type MeetingChatItem } from "./meeting-chat";

/** Postgres + workspace WS — no LiveKit chat subscription. */
export function usePersistedMeetingRoomChat(meetingId: string) {
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant.identity;
  const { data: persisted = [] } = useMeetingChat(meetingId);
  const append = useAppendMeetingChat(meetingId);

  const items: MeetingChatItem[] = useMemo(
    () => toChatItems(persisted, localIdentity),
    [persisted, localIdentity],
  );

  async function send(message: string) {
    await append.mutateAsync(message);
  }

  return {
    items,
    send,
    isSending: append.isPending,
  };
}
