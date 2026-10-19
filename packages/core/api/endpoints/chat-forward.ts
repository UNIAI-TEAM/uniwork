import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

const ForwardedMessagesSchema = z.object({
  messages: z
    .array(z.object({ room_id: z.string(), message_id: z.string() }).nullable().catch(null))
    .nullish()
    .transform((items) => (items ?? []).filter((item) => item !== null)),
});

type ChatForwardedMessage = { room_id: string; message_id: string };

export type ForwardChatMessageInput = {
  /** 1–10 rooms; the server refuses all of them when one refuses (chat_forward_target_refused names it). */
  target_room_ids: string[];
  comment?: string;
};

/** POST …/chat/messages/{id}/forward: the copy written in each target room. */
export async function forwardChatMessage(
  workspaceId: string,
  messageId: string,
  input: ForwardChatMessageInput,
): Promise<ChatForwardedMessage[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/forward`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, ForwardedMessagesSchema, { messages: [] }, {
    endpoint: "POST .../chat/messages/{id}/forward",
  });
  return parsed.messages;
}
