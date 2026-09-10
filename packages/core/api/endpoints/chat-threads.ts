import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import {
  ChatMessageSchema,
  enc,
  type ChatMessageRecord,
} from "./chat-schemas";

const MessagesListSchema = z.object({
  messages: z.array(ChatMessageSchema).optional().default([]),
});

const MessageEnvelopeSchema = z.object({
  message: ChatMessageSchema.optional(),
});

const StatusSchema = z.object({
  ok: z.boolean().optional(),
});

const ChatThreadSchema = z.object({
  thread_root_id: z.string(),
  room_id: z.string(),
  workspace_id: z.string(),
  root_body: z.string().optional().default(""),
  root_sender_id: z.string().optional().default(""),
  reply_count: z.number().optional().default(0),
  last_reply_at: z.string().optional(),
  root_created_at: z.string().optional().default(""),
  unread: z.boolean().optional().default(false),
  reason: z.string().optional().default(""),
});

const ThreadListSchema = z.object({
  threads: z.array(ChatThreadSchema).optional().default([]),
});

export type ChatThreadRecord = z.infer<typeof ChatThreadSchema>;

export async function listChatThreadMessages(
  workspaceId: string,
  roomId: string,
  threadRootId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageRecord[]> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", opts.before);
  const qs = q.toString() ? `?${q}` : "";
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/threads/${enc(threadRootId)}/messages${qs}`,
  );
  const parsed = parseWithFallback(raw, MessagesListSchema, { messages: [] }, {
    endpoint: "GET .../threads/{id}/messages",
  });
  return parsed.messages ?? [];
}

export async function sendChatThreadMessage(
  workspaceId: string,
  roomId: string,
  threadRootId: string,
  input: {
    body: string;
    client_msg_id?: string;
    priority?: string;
  },
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/threads/${enc(threadRootId)}/messages`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, MessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST .../threads/{id}/messages",
  });
  return parsed.message ?? null;
}

export async function followChatThread(
  workspaceId: string,
  threadRootId: string,
): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads/${enc(threadRootId)}/follow`,
    { method: "POST" },
  );
  parseWithFallback(raw, StatusSchema, { ok: true }, {
    endpoint: "POST .../threads/{id}/follow",
  });
}

export async function unfollowChatThread(
  workspaceId: string,
  threadRootId: string,
): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads/${enc(threadRootId)}/follow`,
    { method: "DELETE" },
  );
  parseWithFallback(raw, StatusSchema, { ok: true }, {
    endpoint: "DELETE .../threads/{id}/follow",
  });
}

export async function markChatThreadRead(
  workspaceId: string,
  threadRootId: string,
): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads/${enc(threadRootId)}/read`,
    { method: "POST" },
  );
  parseWithFallback(raw, StatusSchema, { ok: true }, {
    endpoint: "POST .../threads/{id}/read",
  });
}

export async function listFollowedChatThreads(
  workspaceId: string,
  opts: { unread?: boolean; limit?: number } = {},
): Promise<ChatThreadRecord[]> {
  const q = new URLSearchParams();
  if (opts.unread) q.set("unread", "1");
  if (opts.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString() ? `?${q}` : "";
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads${qs}`,
  );
  const parsed = parseWithFallback(raw, ThreadListSchema, { threads: [] }, {
    endpoint: "GET .../chat/threads",
  });
  return parsed.threads ?? [];
}
