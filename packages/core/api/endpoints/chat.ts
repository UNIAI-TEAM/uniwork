import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const WorkspaceChatRoomSchema = z.object({
  workspace_id: z.string(),
  room_id: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});
export type WorkspaceChatRoom = z.infer<typeof WorkspaceChatRoomSchema>;

const ChatUserLookupSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string(),
  matrix_user_id: z.string().optional(),
  matrix_ready: z.boolean().optional().default(false),
});
export type ChatUserLookup = z.infer<typeof ChatUserLookupSchema>;

const enc = encodeURIComponent;

function toWorkspaceChatRoom(data: WorkspaceChatRoom | null): WorkspaceChatRoom | null {
  if (!data?.enabled) return null;
  if (!data.room_id) return null;
  return data;
}

export async function getWorkspaceChatRoom(workspaceId: string): Promise<WorkspaceChatRoom | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/room`);
  const parsed = parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/room",
  });
  return toWorkspaceChatRoom(parsed);
}

export async function ensureWorkspaceChatRoom(
  workspaceId: string,
  matrixAccessToken: string,
): Promise<WorkspaceChatRoom | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/room`, {
    method: "POST",
    body: { matrix_access_token: matrixAccessToken },
  });
  return parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/room",
  });
}

export async function lookupChatUser(email: string): Promise<ChatUserLookup | null> {
  const q = enc(email.trim().toLowerCase());
  const raw = await request(`/api/v1/chat/users/lookup?email=${q}`);
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/chat/users/lookup",
  });
}

export async function lookupChatUserById(userId: string): Promise<ChatUserLookup | null> {
  const q = enc(userId.trim().toUpperCase());
  const raw = await request(`/api/v1/chat/users/lookup?user_id=${q}`);
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/chat/users/lookup",
  });
}

const ChatVoiceTokenSchema = z.object({
  token: z.string(),
  url: z.string(),
});
export type ChatVoiceToken = z.infer<typeof ChatVoiceTokenSchema>;

/** LiveKit JWT for a DM voice call — fails loud when LiveKit is not configured. */
export async function mintChatVoiceToken(matrixRoomId: string): Promise<ChatVoiceToken | null> {
  const raw = await request("/api/v1/chat/voice/token", {
    method: "POST",
    body: { matrix_room_id: matrixRoomId.trim() },
  });
  return parseWithFallback<ChatVoiceToken | null>(raw, ChatVoiceTokenSchema, null, {
    endpoint: "POST /api/v1/chat/voice/token",
  });
}
