import { z } from "zod";
import { parseWithFallback } from "../schema";
import {
  ChatMessageEnvelopeSchema,
  ChatMessagesListSchema,
  ChatRoomEnvelopeSchema,
  type ChatMessageRecord,
  type ChatRoomRecord,
} from "./chat-schemas";

/**
 * The answer readers every chat endpoint factory shares (chat-*-api.ts). Pure:
 * no transport, so the phone (apps/chat-mobile, ADR 0011) carries it through
 * the factories it imports.
 */

const StatusSchema = z.object({ status: z.string().optional() });

/** A `{status: "ok"}` answer; anything else, a drifted body included, reads as false. */
export async function readStatusOk(raw: Promise<unknown>, endpoint: string): Promise<boolean> {
  return parseWithFallback(await raw, StatusSchema, { status: "" }, { endpoint }).status === "ok";
}

/** A `{room}` answer; null when it carries none. */
export async function readRoom(raw: Promise<unknown>, endpoint: string): Promise<ChatRoomRecord | null> {
  return parseWithFallback(await raw, ChatRoomEnvelopeSchema, { room: undefined }, { endpoint }).room ?? null;
}

/** A `{message}` answer; null when it carries none. */
export async function readMessage(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord | null> {
  return parseWithFallback(await raw, ChatMessageEnvelopeSchema, { message: undefined }, { endpoint }).message ?? null;
}

/** A `{messages}` answer; empty when it carries none. */
export async function readMessages(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord[]> {
  return parseWithFallback(await raw, ChatMessagesListSchema, { messages: [] }, { endpoint }).messages ?? [];
}

/** `?a=1&b=2` of the params that have a value, in the order given; "" when none has. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    p.set(key, String(value));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
