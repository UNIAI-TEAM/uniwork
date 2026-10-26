import { z } from "zod";
import { parseWithFallback } from "../schema";
import { queryString, readMessage, readMessages } from "./chat-endpoint-kit";
import { enc } from "./chat-schemas";
import type { ChatMessageRecord, ChatRequest } from "./chat-schemas";

/**
 * The chat thread endpoints over any transport: chat-threads.ts binds them to
 * the web's, the phone (apps/chat-mobile, ADR 0011) to its own. A thread's
 * replies read through the lenient message list, so one drifted reply is
 * dropped alone instead of blanking the thread.
 */

const FollowStatusSchema = z.object({ ok: z.boolean().optional() });

const ThreadReadSchema = z.object({ previous_read_at: z.string().optional().catch(undefined) });

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

const ThreadListSchema = z.object({ threads: z.array(ChatThreadSchema).optional().default([]) });

export type ChatThreadRecord = z.infer<typeof ChatThreadSchema>;

export function createChatThreadsApi(request: ChatRequest) {
  const ws = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}`;
  const replies = (workspaceId: string, roomId: string, rootId: string) =>
    `${ws(workspaceId)}/chat/rooms/${enc(roomId)}/threads/${enc(rootId)}/messages`;
  const thread = (workspaceId: string, rootId: string) => `${ws(workspaceId)}/chat/threads/${enc(rootId)}`;

  async function follow(workspaceId: string, rootId: string, method: "POST" | "DELETE"): Promise<void> {
    const raw = await request(`${thread(workspaceId, rootId)}/follow`, { method });
    parseWithFallback(raw, FollowStatusSchema, { ok: true }, { endpoint: `${method} .../threads/{id}/follow` });
  }

  return {
    listChatThreadMessages(
      workspaceId: string,
      roomId: string,
      threadRootId: string,
      opts: { limit?: number; cursor?: string; before?: string } = {},
    ): Promise<ChatMessageRecord[]> {
      const qs = queryString({ limit: opts.limit, cursor: opts.cursor, before: opts.before });
      return readMessages(request(`${replies(workspaceId, roomId, threadRootId)}${qs}`), "GET .../threads/{id}/messages");
    },

    sendChatThreadMessage(
      workspaceId: string,
      roomId: string,
      threadRootId: string,
      input: { body: string; client_msg_id?: string; priority?: string },
    ): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(replies(workspaceId, roomId, threadRootId), { method: "POST", body: input }),
        "POST .../threads/{id}/messages",
      );
    },

    followChatThread(workspaceId: string, threadRootId: string): Promise<void> {
      return follow(workspaceId, threadRootId, "POST");
    },

    unfollowChatThread(workspaceId: string, threadRootId: string): Promise<void> {
      return follow(workspaceId, threadRootId, "DELETE");
    },

    /** Marks the thread read; resolves to the read pointer it replaced, or null. */
    async markChatThreadRead(workspaceId: string, threadRootId: string): Promise<string | null> {
      const raw = await request(`${thread(workspaceId, threadRootId)}/read`, { method: "POST" });
      const out = parseWithFallback(raw, ThreadReadSchema, { previous_read_at: undefined }, {
        endpoint: "POST .../threads/{id}/read",
      });
      return out.previous_read_at || null;
    },

    async listFollowedChatThreads(workspaceId: string, opts: { unread?: boolean; limit?: number } = {}): Promise<ChatThreadRecord[]> {
      const qs = queryString({ unread: opts.unread ? "1" : undefined, limit: opts.limit });
      const raw = await request(`${ws(workspaceId)}/chat/threads${qs}`);
      const parsed = parseWithFallback(raw, ThreadListSchema, { threads: [] }, { endpoint: "GET .../chat/threads" });
      return parsed.threads ?? [];
    },
  };
}
