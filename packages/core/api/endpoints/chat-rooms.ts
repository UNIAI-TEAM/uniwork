import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import {
  ChatRoomEnvelopeSchema,
  ChatRoomMemberPermissionsSchema,
  ChatRoomMemberSchema,
  ChatRoomsListSchema,
  WorkspaceChatRoomSchema,
  enc,
  toWorkspaceChatRoom,
} from "./chat-schemas";
import type {
  ChatRoomMemberPermissions,
  ChatRoomMemberRecord,
  ChatRoomRecord,
  WorkspaceChatRoom,
} from "./chat-schemas";

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

export async function removeWorkspaceChatRoomMember(
  workspaceId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  return removeChatRoomMember(workspaceId, roomId, userId);
}

export async function removeChatRoomMember(
  workspaceId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/members/${enc(userId)}`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members/{userID}",
  });
  return parsed.status === "ok";
}

export async function listChatRoomMembers(
  workspaceId: string,
  roomId: string,
): Promise<ChatRoomMemberRecord[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/members`,
  );
  const parsed = parseWithFallback(
    raw,
    z.object({ members: z.array(ChatRoomMemberSchema).optional() }),
    { members: [] },
    { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members" },
  );
  return parsed.members ?? [];
}

export async function patchChatRoomMember(
  workspaceId: string,
  roomId: string,
  userId: string,
  body: { role?: "admin" | "member"; send_restricted?: boolean },
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/members/${enc(userId)}`,
    { method: "PATCH", body },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members/{userID}",
  });
  return parsed.status === "ok";
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

export async function patchChatRoom(
  workspaceId: string,
  roomId: string,
  body: {
    name?: string;
    member_permissions?: Partial<ChatRoomMemberPermissions>;
  },
): Promise<ChatRoomMemberPermissions> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}`,
    { method: "PATCH", body },
  );
  return parseWithFallback(raw, ChatRoomMemberPermissionsSchema, {
    allow_change_profile: true,
    allow_pin_content: true,
    allow_create_notes: true,
    allow_create_polls: true,
    allow_send_messages: true,
  }, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}",
  });
}
