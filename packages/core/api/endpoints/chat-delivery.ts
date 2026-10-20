import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

/** One room of a delivery ack: this device holds its messages up to `up_to` (RFC 3339). */
export type ChatDeliveredRoom = { room_id: string; up_to: string };

/** The server takes at most this many rooms in one ack. */
export const CHAT_DELIVERED_MAX_ROOMS = 50;

/** Tells the server this device holds these rooms' messages: their senders see ✓✓ (UNI-1908 F4). */
export async function ackChatDelivered(workspaceId: string, rooms: ChatDeliveredRoom[]): Promise<boolean> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/delivered`, {
    method: "POST",
    body: { rooms },
  });
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST .../chat/delivered",
  });
  return parsed.status === "ok";
}
