import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

const ChatLinkPreviewSchema = z.object({
  message_id: z.string(),
  url: z.string().catch(""),
  title: z.string().catch(""),
  description: z.string().optional().catch(undefined),
  site_name: z.string().optional().catch(undefined),
  image_url: z.string().optional().catch(undefined),
  image_url_expires_at: z.string().optional().catch(undefined),
});

const ChatLinkPreviewListSchema = z.object({
  previews: z.array(ChatLinkPreviewSchema).catch([]),
});

/**
 * The card of the first link a message names (ADR 0035): read by the server
 * when the message was sent, its picture signed out of UniWork storage, so
 * showing it never contacts the linked site.
 */
export type ChatLinkPreview = z.infer<typeof ChatLinkPreviewSchema>;

/** Link cards of many messages in one room, in one request (at most 200 ids). */
export async function listChatRoomLinkPreviews(
  workspaceId: string,
  roomId: string,
  messageIds: string[],
): Promise<ChatLinkPreview[]> {
  if (messageIds.length === 0) return [];
  const params = new URLSearchParams({ message_ids: messageIds.join(",") });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/link-previews?${params.toString()}`,
  );
  return parseWithFallback(raw, ChatLinkPreviewListSchema, { previews: [] }, {
    endpoint: "GET .../chat/rooms/{roomID}/link-previews",
  }).previews;
}
