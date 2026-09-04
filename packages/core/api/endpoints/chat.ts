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
});
export type ChatUserLookup = z.infer<typeof ChatUserLookupSchema>;

const ChatMessageSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  workspace_id: z.string(),
  sender_id: z.string(),
  sender_display_name: z.string(),
  kind: z.string().optional().default("text"),
  body: z.string(),
  reply_to_message_id: z.string().optional(),
  created_at: z.string(),
  reactions: z
    .record(z.string(), z.number())
    .nullish()
    .transform((value) => value ?? {}),
  voice_call: z
    .object({
      outcome: z.string(),
      duration_seconds: z.number().optional(),
      caller_id: z.string(),
    })
    .optional(),
});
export type ChatMessageRecord = z.infer<typeof ChatMessageSchema>;

const ChatMessagesListSchema = z.object({
  messages: z.array(ChatMessageSchema).optional().default([]),
});

const ChatMessageEnvelopeSchema = z.object({
  message: ChatMessageSchema.optional(),
});

const ChatRoomSchema = z.object({
  id: z.string(),
  kind: z.enum(["workspace", "dm", "group"]),
  name: z.string(),
  workspace_id: z.string(),
  // Go encodes nil slices as JSON null; treat null like [] so one bad field does not drop the whole list.
  member_user_ids: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  unread_count: z.number().optional().default(0),
  peer_user_id: z.string().optional(),
  peer_email: z.string().optional(),
  peer_display_name: z.string().optional(),
});
export type ChatRoomRecord = z.infer<typeof ChatRoomSchema>;

const ChatRoomsListSchema = z.object({
  rooms: z.array(ChatRoomSchema).optional().default([]),
});

const ChatRoomEnvelopeSchema = z.object({
  room: ChatRoomSchema.optional(),
});

const enc = encodeURIComponent;

function toWorkspaceChatRoom(data: WorkspaceChatRoom | null): WorkspaceChatRoom | null {
  if (!data?.enabled) return null;
  return data;
}

export async function listChatRooms(workspaceId: string): Promise<ChatRoomRecord[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/rooms`);
  const parsed = parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms",
  });
  return parsed.rooms ?? [];
}

export async function resolveDMRoom(workspaceId: string, userId: string): Promise<ChatRoomRecord | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/dm`, {
    method: "POST",
    body: { user_id: userId },
  });
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/dm",
  });
  return parsed.room ?? null;
}

export async function createChatGroup(
  workspaceId: string,
  input: { name: string; member_user_ids: string[] },
): Promise<ChatRoomRecord | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/groups`, {
    method: "POST",
    body: input,
  });
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/groups",
  });
  return parsed.room ?? null;
}

export async function inviteChatGroupMembers(
  workspaceId: string,
  roomId: string,
  memberUserIds: string[],
): Promise<ChatRoomRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/members`,
    { method: "POST", body: { member_user_ids: memberUserIds } },
  );
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members",
  });
  return parsed.room ?? null;
}

export async function leaveChatRoom(workspaceId: string, roomId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/leave`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/leave",
  });
  return parsed.status === "ok";
}

export async function listChatRoomMessages(
  workspaceId: string,
  roomId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages${qs ? `?${qs}` : ""}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages",
  });
  return parsed.messages ?? [];
}

export async function sendChatRoomMessage(
  workspaceId: string,
  roomId: string,
  input: { body: string; reply_to_message_id?: string },
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages",
  });
  return parsed.message ?? null;
}

export async function toggleChatMessageReaction(
  workspaceId: string,
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/reactions`,
    { method: "POST", body: { emoji } },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/reactions",
  });
  return parsed.message ?? null;
}

export async function getWorkspaceChatRoom(workspaceId: string): Promise<WorkspaceChatRoom | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/room`);
  const parsed = parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/room",
  });
  return toWorkspaceChatRoom(parsed);
}

export async function ensureWorkspaceChatRoom(workspaceId: string): Promise<WorkspaceChatRoom | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/room`, {
    method: "POST",
    body: {},
  });
  return parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/room",
  });
}

export async function listWorkspaceChatMessages(
  workspaceId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages${qs ? `?${qs}` : ""}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/messages",
  });
  return parsed.messages ?? [];
}

export async function sendWorkspaceChatMessage(
  workspaceId: string,
  input: { body: string; reply_to_message_id?: string },
): Promise<ChatMessageRecord | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/messages`, {
    method: "POST",
    body: input,
  });
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/messages",
  });
  return parsed.message ?? null;
}

export async function lookupChatUser(
  workspaceId: string,
  email: string,
): Promise<ChatUserLookup | null> {
  const q = enc(email.trim().toLowerCase());
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/lookup?email=${q}`,
  );
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/lookup",
  });
}

export async function lookupChatUserById(
  workspaceId: string,
  userId: string,
): Promise<ChatUserLookup | null> {
  const q = enc(userId.trim().toUpperCase());
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/lookup?user_id=${q}`,
  );
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/lookup",
  });
}

const ChatBlockStatusSchema = z.object({
  blocked_by_me: z.boolean().optional().default(false),
  blocked_me: z.boolean().optional().default(false),
});
export type ChatBlockStatus = z.infer<typeof ChatBlockStatusSchema>;

export async function getChatBlockStatus(
  workspaceId: string,
  userId: string,
): Promise<ChatBlockStatus> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
  );
  return parseWithFallback(raw, ChatBlockStatusSchema, { blocked_by_me: false, blocked_me: false }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
}

export async function blockChatUser(workspaceId: string, userId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
  return parsed.status === "ok";
}

export async function unblockChatUser(workspaceId: string, userId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
  return parsed.status === "ok";
}

const ChatVoiceTokenSchema = z.object({
  token: z.string(),
  url: z.string(),
});
export type ChatVoiceToken = z.infer<typeof ChatVoiceTokenSchema>;

/** LiveKit JWT for a native chat room voice call. */
export async function mintChatVoiceToken(
  roomId: string,
  callId: string,
): Promise<ChatVoiceToken | null> {
  const raw = await request("/api/v1/chat/voice/token", {
    method: "POST",
    body: { room_id: roomId.trim(), call_id: callId.trim() },
  });
  return parseWithFallback<ChatVoiceToken | null>(raw, ChatVoiceTokenSchema, null, {
    endpoint: "POST /api/v1/chat/voice/token",
  });
}

export async function signalChatVoiceInvite(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/invite`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/invite",
  });
  return parsed.status === "ok";
}

export async function signalChatVoiceAccept(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/accept`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/accept",
  });
  return parsed.status === "ok";
}

export async function signalChatVoiceHangup(
  workspaceId: string,
  roomId: string,
  callId: string,
  durationSeconds?: number,
): Promise<boolean> {
  const body: { call_id: string; duration_seconds?: number } = { call_id: callId };
  if (durationSeconds != null && durationSeconds > 0) {
    body.duration_seconds = durationSeconds;
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/hangup`,
    { method: "POST", body },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/hangup",
  });
  return parsed.status === "ok";
}

export async function signalChatTyping(workspaceId: string, roomId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/typing`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/typing",
  });
  return parsed.status === "ok";
}
