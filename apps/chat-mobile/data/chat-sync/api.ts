// GET /api/v1/workspaces/{ws}/chat/sync (ADR 0039 draft, phase 1;
// server/internal/handler/chat_sync.go): the chat changes after the head this
// phone last read, one line per message with the message as it is now. Only
// the phone reads it, so it lives here, not in a core endpoint factory. An
// answer that does not parse is no answer (null): nothing is applied, the
// head is kept, and the caller falls back to refetching what it shows.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { ChatMessageSchema, enc } from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import { api } from "../api";

const ChatSyncChangeSchema = z.object({
  seq: z.number().int().nonnegative(),
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  // created | updated | deleted; read as a string (server enum), narrowed where it is used.
  kind: z.string(),
  message: ChatMessageSchema.nullable(),
});

export const ChatSyncSchema = z.object({
  head: z.number().int().nonnegative(),
  reset: z.boolean(),
  // The page stopped at the server's cap (200): more changes follow head. Absent from an older server: complete.
  more: z.boolean().optional(),
  changes: z.array(ChatSyncChangeSchema),
});

export type ChatSyncPage = z.infer<typeof ChatSyncSchema>;
export type ChatSyncChange = ChatSyncPage["changes"][number];

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

export function createChatSyncApi(request: Request) {
  return {
    /** The changes after `since`; with `since` null, only where the log is. Null when the answer does not parse. */
    async sync(wsId: string, since: number | null, signal?: AbortSignal): Promise<ChatSyncPage | null> {
      const query = since === null ? "" : `?since=${since}`;
      const raw = await request(`/api/v1/workspaces/${enc(wsId)}/chat/sync${query}`, signal ? { signal } : undefined);
      return parseWithFallback(raw, ChatSyncSchema.nullable(), null, { endpoint: "GET .../chat/sync" });
    },
  };
}

export type ChatSyncApi = ReturnType<typeof createChatSyncApi>;

export const chatSyncApi: ChatSyncApi = createChatSyncApi((path, init) => api.request(path, init));
