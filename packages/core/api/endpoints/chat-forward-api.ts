import { z } from "zod";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";
import type { ChatRequest } from "./chat-schemas";

/**
 * Forwarding a chat message over any transport: chat-forward.ts binds it to
 * the web's, the phone (apps/chat-mobile, ADR 0011) to its own.
 */

const ForwardedMessagesSchema = z.object({
  messages: z
    .array(z.object({ room_id: z.string(), message_id: z.string() }).nullable().catch(null))
    .nullish()
    .transform((items) => (items ?? []).filter((item) => item !== null)),
});

export type ChatForwardedMessage = { room_id: string; message_id: string };

export type ForwardChatMessageInput = {
  /** 1–10 rooms; the server refuses all of them when one refuses (chat_forward_target_refused names it). */
  target_room_ids: string[];
  comment?: string;
};

export function createChatForwardApi(request: ChatRequest) {
  return {
    /** POST …/chat/messages/{id}/forward: the copy written in each target room. */
    async forwardChatMessage(workspaceId: string, messageId: string, input: ForwardChatMessageInput): Promise<ChatForwardedMessage[]> {
      const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/forward`, {
        method: "POST",
        body: input,
      });
      return parseWithFallback(raw, ForwardedMessagesSchema, { messages: [] }, {
        endpoint: "POST .../chat/messages/{id}/forward",
      }).messages;
    },
  };
}
