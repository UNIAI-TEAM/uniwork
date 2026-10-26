import { z } from "zod";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";
import type { ChatRequest } from "./chat-schemas";

/**
 * The presence heartbeat over any transport: chat-presence.ts binds it to the
 * web's, the phone (apps/chat-mobile, ADR 0011) to its own. Pure: no transport
 * of its own, which is what lets the phone import it.
 */

const ChatPresenceBeatSchema = z.object({
  status: z.string().optional(),
  online_user_ids: z.array(z.string()).optional(),
});

export function createChatPresenceApi(request: ChatRequest) {
  return {
    /**
     * One online heartbeat. Resolves to the workspace's online user ids (the
     * caller included), or null when the answer carries none — a server that
     * predates the list, a store that could not answer, or a drifted body. On
     * null the caller keeps expiring peers itself. `visible` says the page is in
     * front of its user: only a visible beat holds back chat pushes to them.
     */
    async beatChatPresence(workspaceId: string, visible: boolean): Promise<string[] | null> {
      const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/presence`, {
        method: "POST",
        body: { state: "online", visible },
      });
      const parsed = parseWithFallback<z.infer<typeof ChatPresenceBeatSchema>>(raw, ChatPresenceBeatSchema, {}, {
        endpoint: "POST /api/v1/workspaces/{ws}/chat/presence",
      });
      return parsed.online_user_ids ?? null;
    },
  };
}
