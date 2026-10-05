import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

const ChatPresenceBeatSchema = z.object({
  status: z.string().optional(),
  online_user_ids: z.array(z.string()).optional(),
});

/**
 * One online heartbeat. Resolves to the workspace's online user ids (the
 * caller included), or null when the answer carries none — a server that
 * predates the list, a store that could not answer, or a drifted body. On
 * null the caller keeps expiring peers itself.
 */
export async function beatChatPresence(workspaceId: string): Promise<string[] | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/presence`, {
    method: "POST",
    body: { state: "online" },
  });
  const parsed = parseWithFallback<z.infer<typeof ChatPresenceBeatSchema>>(
    raw,
    ChatPresenceBeatSchema,
    {},
    { endpoint: "POST /api/v1/workspaces/{ws}/chat/presence" },
  );
  return parsed.online_user_ids ?? null;
}
