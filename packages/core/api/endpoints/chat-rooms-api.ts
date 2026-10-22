import { z } from "zod";
import { parseWithFallback } from "../schema";
import { readRoom, readStatusOk } from "./chat-endpoint-kit";
import {
  ChatRoomMemberPermissionsSchema,
  ChatRoomMemberSchema,
  ChatRoomsListSchema,
  ChatUnreadSummarySchema,
  EMPTY_UNREAD_SUMMARY,
  WorkspaceChatRoomSchema,
  enc,
  toWorkspaceChatRoom,
} from "./chat-schemas";
import type {
  ChatRequest,
  ChatRoomMemberPermissions,
  ChatRoomMemberRecord,
  ChatRoomRecord,
  ChatUnreadSummary,
  WorkspaceChatRoom,
} from "./chat-schemas";

/**
 * The chat room endpoints over any transport: chat-rooms.ts binds them to the
 * web's, the phone (apps/chat-mobile, ADR 0011) to its own, so both read every
 * answer the same way. The avatar upload stays in chat-rooms.ts: its body is a
 * browser File in FormData, which a JSON transport does not carry.
 */

const RoomMembersSchema = z.object({ members: z.array(ChatRoomMemberSchema).optional() });

const OPEN_PERMISSIONS: ChatRoomMemberPermissions = {
  allow_change_profile: true,
  allow_pin_content: true,
  allow_create_notes: true,
  allow_create_polls: true,
  allow_send_messages: true,
  allow_forward: true,
};

export function createChatRoomsApi(request: ChatRequest) {
  const ws = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}`;
  const room = (workspaceId: string, roomId: string) => `${ws(workspaceId)}/chat/rooms/${enc(roomId)}`;
  const member = (workspaceId: string, roomId: string, userId: string) =>
    `${room(workspaceId, roomId)}/members/${enc(userId)}`;

  return {
    /** The signal lets a query abort a superseded room-list load on the wire. */
    async listChatRooms(workspaceId: string, signal?: AbortSignal): Promise<ChatRoomRecord[]> {
      const raw = await request(`${ws(workspaceId)}/chat/rooms`, { signal });
      const parsed = parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms",
      });
      return parsed.rooms ?? [];
    },

    /** Unread counts per workspace, for the workspace switch and its badges. */
    async getChatUnreadSummary(signal?: AbortSignal): Promise<ChatUnreadSummary> {
      const raw = await request("/api/v1/me/chat/unread-summary", { signal });
      return parseWithFallback(raw, ChatUnreadSummarySchema, EMPTY_UNREAD_SUMMARY, {
        endpoint: "GET /api/v1/me/chat/unread-summary",
      });
    },

    resolveDMRoom(workspaceId: string, userId: string): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(`${ws(workspaceId)}/chat/dm`, { method: "POST", body: { user_id: userId } }),
        "POST /api/v1/workspaces/{ws}/chat/dm",
      );
    },

    createChatGroup(workspaceId: string, input: { name: string; member_user_ids: string[] }): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(`${ws(workspaceId)}/chat/groups`, { method: "POST", body: input }),
        "POST /api/v1/workspaces/{ws}/chat/groups",
      );
    },

    /** The group after the invite, or null. */
    inviteChatGroupMembers(workspaceId: string, roomId: string, memberUserIds: string[]): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(`${room(workspaceId, roomId)}/members`, { method: "POST", body: { member_user_ids: memberUserIds } }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members",
      );
    },

    removeChatRoomAvatar(workspaceId: string, roomId: string): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(`${room(workspaceId, roomId)}/avatar`, { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/avatar",
      );
    },

    leaveChatRoom(workspaceId: string, roomId: string): Promise<boolean> {
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/leave`, { method: "POST", body: {} }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/leave",
      );
    },

    removeChatRoomMember(workspaceId: string, roomId: string, userId: string): Promise<boolean> {
      return readStatusOk(
        request(member(workspaceId, roomId, userId), { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members/{userID}",
      );
    },

    async listChatRoomMembers(workspaceId: string, roomId: string): Promise<ChatRoomMemberRecord[]> {
      const raw = await request(`${room(workspaceId, roomId)}/members`);
      const parsed = parseWithFallback(raw, RoomMembersSchema, { members: [] }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members",
      });
      return parsed.members ?? [];
    },

    patchChatRoomMember(
      workspaceId: string,
      roomId: string,
      userId: string,
      body: { role?: "admin" | "member"; send_restricted?: boolean },
    ): Promise<boolean> {
      return readStatusOk(
        request(member(workspaceId, roomId, userId), { method: "PATCH", body }),
        "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members/{userID}",
      );
    },

    async getWorkspaceChatRoom(workspaceId: string): Promise<WorkspaceChatRoom | null> {
      const raw = await request(`${ws(workspaceId)}/chat/room`);
      const parsed = parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/room",
      });
      return toWorkspaceChatRoom(parsed);
    },

    async ensureWorkspaceChatRoom(workspaceId: string): Promise<WorkspaceChatRoom | null> {
      const raw = await request(`${ws(workspaceId)}/chat/room`, { method: "POST", body: {} });
      return parseWithFallback<WorkspaceChatRoom | null>(raw, WorkspaceChatRoomSchema, null, {
        endpoint: "POST /api/v1/workspaces/{ws}/chat/room",
      });
    },

    /**
     * The room detail read: the one place the server resolves viewer-scoped
     * room state like `can_send_document`. The room list never carries those.
     */
    getChatRoom(workspaceId: string, roomId: string): Promise<ChatRoomRecord | null> {
      return readRoom(request(room(workspaceId, roomId)), "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}");
    },

    async patchChatRoom(
      workspaceId: string,
      roomId: string,
      body: {
        name?: string;
        /** The room's description; "" clears it. */
        topic?: string;
        member_permissions?: Partial<ChatRoomMemberPermissions>;
      },
    ): Promise<ChatRoomMemberPermissions> {
      const raw = await request(room(workspaceId, roomId), { method: "PATCH", body });
      return parseWithFallback(raw, ChatRoomMemberPermissionsSchema, OPEN_PERMISSIONS, {
        endpoint: "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}",
      });
    },
  };
}
