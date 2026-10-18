"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forwardChatMessage, type ForwardChatMessageInput } from "../api/endpoints/chat-forward";
import { chatKeys } from "./chat-keys";

/** Forward one message into up to ten rooms; each target's timeline and the room list refresh. */
export function useForwardChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string } & ForwardChatMessageInput) => {
      const { messageId, ...body } = input;
      return forwardChatMessage(workspaceId, messageId, body);
    },
    onSuccess: (copies) => {
      for (const copy of copies) {
        void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(workspaceId, copy.room_id) });
      }
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}
