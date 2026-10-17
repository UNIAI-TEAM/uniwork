// The chat endpoints the mobile chat tab calls, copied from
// packages/core/api/endpoints/{chat-rooms,chat-messages,chat-threads,
// chat-channels,chat-users,chat-presence,chat-voice}.ts and workspaces.ts
// (ADR 0011: those reach the web transport). Same paths, same lenient schemas
// (imported from the allowlisted chat-schemas), same fallbacks; only the
// transport is the app's own. chat-api.test.ts holds a malformed-response
// case for every one of them.
import { parseWithFallback } from "@uniwork/core/api/schema";
import {
  ChatMessageEnvelopeSchema,
  ChatMessagesListSchema,
  ChatNicknameMapSchema,
  ChatRoomEnvelopeSchema,
  ChatRoomMemberSchema,
  ChatRoomsListSchema,
  enc,
  type ChatMessageRecord,
  type ChatNicknameMap,
  type ChatRoomMemberRecord,
  type ChatRoomRecord,
} from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import { api } from "./api";
import type { PendingFile } from "@/lib/send-pipeline";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const StatusSchema = z.object({ status: z.string().optional() });

const MembersSchema = z.object({ members: z.array(ChatRoomMemberSchema).optional() });

/** A workspace member as the new-DM picker and mention list need one. */
export interface WorkspaceMemberRecord {
  user_id: string;
  email: string;
  display_name: string;
}

const WorkspaceMemberSchema = z.object({
  user_id: z.string(),
  email: z.string().catch(""),
  display_name: z.string().catch(""),
});

// One drifted member must not empty the picker.
const WorkspaceMembersSchema = z.object({
  members: z
    .array(z.unknown())
    .nullish()
    .transform((items) =>
      (items ?? []).flatMap((item) => {
        const parsed = WorkspaceMemberSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

const PresenceBeatSchema = z.object({ online_user_ids: z.array(z.string()).optional() });

const ThreadReadSchema = z.object({ previous_read_at: z.string().optional().catch(undefined) });

function query(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    p.set(key, String(value));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const json = (method: string, body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

export function createChatApi(request: Request) {
  const ws = (wsId: string) => `/api/v1/workspaces/${enc(wsId)}`;
  const room = (wsId: string, roomId: string) => `${ws(wsId)}/chat/rooms/${enc(roomId)}`;

  async function message(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord | null> {
    return parseWithFallback(await raw, ChatMessageEnvelopeSchema, { message: undefined }, { endpoint }).message ?? null;
  }
  async function messages(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord[]> {
    return parseWithFallback(await raw, ChatMessagesListSchema, { messages: [] }, { endpoint }).messages;
  }
  async function roomOf(raw: Promise<unknown>, endpoint: string): Promise<ChatRoomRecord | null> {
    return parseWithFallback(await raw, ChatRoomEnvelopeSchema, { room: undefined }, { endpoint }).room ?? null;
  }
  async function ok(raw: Promise<unknown>, endpoint: string): Promise<boolean> {
    return parseWithFallback(await raw, StatusSchema, { status: "" }, { endpoint }).status === "ok";
  }

  return {
    async listRooms(wsId: string, signal?: AbortSignal): Promise<ChatRoomRecord[]> {
      const raw = await request(`${ws(wsId)}/chat/rooms`, { signal });
      return parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms" }).rooms;
    },
    resolveDMRoom(wsId: string, userId: string) {
      return roomOf(request(`${ws(wsId)}/chat/dm`, json("POST", { user_id: userId })), "POST /api/v1/workspaces/{ws}/chat/dm");
    },
    leaveRoom(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/leave`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/leave");
    },
    async listRoomMembers(wsId: string, roomId: string): Promise<ChatRoomMemberRecord[]> {
      const raw = await request(`${room(wsId, roomId)}/members`);
      return parseWithFallback(raw, MembersSchema, { members: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members" })
        .members ?? [];
    },
    setRoomMuted(wsId: string, roomId: string, muted: boolean) {
      return ok(request(`${room(wsId, roomId)}/mute`, { method: muted ? "POST" : "DELETE" }), "POST|DELETE .../chat/rooms/{roomID}/mute");
    },
    markRoomRead(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/read`, json("POST")), "POST .../chat/rooms/{roomID}/read");
    },
    listMessages(
      wsId: string,
      roomId: string,
      options: { cursor?: string; before?: string; after?: string; limit?: number; markRead?: boolean } = {},
      signal?: AbortSignal,
    ) {
      const qs = query({
        cursor: options.cursor,
        after: options.after,
        before: options.before,
        limit: options.limit,
        // Default true on the server; 0 keeps the read pointer where it was.
        mark_read: options.markRead === false ? "0" : undefined,
      });
      return messages(request(`${room(wsId, roomId)}/messages${qs}`, { signal }), "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages");
    },
    listMessagesAround(wsId: string, roomId: string, messageId: string, limit = 50) {
      return messages(
        request(`${room(wsId, roomId)}/messages/around/${enc(messageId)}${query({ limit })}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/around/{messageID}",
      );
    },
    getMessage(wsId: string, roomId: string, messageId: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    searchMessages(wsId: string, roomId: string, q: string, limit = 30) {
      return messages(
        request(`${room(wsId, roomId)}/messages/search${query({ q, limit })}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/search",
      );
    },
    sendMessage(wsId: string, roomId: string, input: { body: string; client_msg_id: string; reply_to_message_id?: string }) {
      return message(request(`${room(wsId, roomId)}/messages`, json("POST", input)), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages");
    },
    sendFileMessage(wsId: string, roomId: string, input: { file: PendingFile; client_msg_id: string; reply_to_message_id?: string }) {
      const form = new FormData();
      // React Native's FormData uploads a { uri, name, type } part from disk.
      form.append("file", { uri: input.file.uri, name: input.file.name, type: input.file.mimeType ?? "application/octet-stream" } as unknown as Blob);
      form.append("client_msg_id", input.client_msg_id);
      if (input.reply_to_message_id) form.append("reply_to_message_id", input.reply_to_message_id);
      return message(
        request(`${room(wsId, roomId)}/messages/file`, { method: "POST", body: form }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/file",
      );
    },
    toggleReaction(wsId: string, roomId: string, messageId: string, emoji: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}/reactions`, json("POST", { emoji })),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/reactions",
      );
    },
    editMessage(wsId: string, roomId: string, messageId: string, body: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`, json("PATCH", { body })),
        "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    deleteMessage(wsId: string, roomId: string, messageId: string) {
      return ok(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`, { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    listThreadMessages(wsId: string, roomId: string, rootId: string, options: { cursor?: string; before?: string; limit?: number } = {}) {
      return messages(
        request(`${room(wsId, roomId)}/threads/${enc(rootId)}/messages${query({ limit: options.limit, cursor: options.cursor, before: options.before })}`),
        "GET .../threads/{id}/messages",
      );
    },
    sendThreadMessage(wsId: string, roomId: string, rootId: string, input: { body: string; client_msg_id: string }) {
      return message(request(`${room(wsId, roomId)}/threads/${enc(rootId)}/messages`, json("POST", input)), "POST .../threads/{id}/messages");
    },
    async markThreadRead(wsId: string, rootId: string): Promise<string | null> {
      const raw = await request(`${ws(wsId)}/chat/threads/${enc(rootId)}/read`, { method: "POST" });
      return parseWithFallback(raw, ThreadReadSchema, { previous_read_at: undefined }, { endpoint: "POST .../threads/{id}/read" })
        .previous_read_at || null;
    },
    async listChannels(wsId: string, scope: "mine" | "discoverable"): Promise<ChatRoomRecord[]> {
      const raw = await request(`${ws(wsId)}/chat/channels${query({ scope })}`);
      return parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/channels" }).rooms;
    },
    joinChannel(wsId: string, roomId: string) {
      return roomOf(request(`${ws(wsId)}/chat/channels/${enc(roomId)}/join`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/join");
    },
    async listNicknames(wsId: string): Promise<Record<string, string>> {
      const raw = await request(`${ws(wsId)}/chat/nicknames`);
      const parsed = parseWithFallback<ChatNicknameMap>(raw, ChatNicknameMapSchema, { nicknames: {} }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/nicknames" });
      const out: Record<string, string> = {};
      for (const [userId, nickname] of Object.entries(parsed.nicknames)) {
        const key = userId.trim().toUpperCase();
        if (key) out[key] = nickname;
      }
      return out;
    },
    async listWorkspaceMembers(wsId: string): Promise<WorkspaceMemberRecord[]> {
      const raw = await request(`${ws(wsId)}/members`);
      return parseWithFallback(raw, WorkspaceMembersSchema, { members: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/members" }).members;
    },
    /** One online heartbeat; the workspace's online user ids, or null when the answer carries none. */
    async beatPresence(wsId: string, visible: boolean): Promise<string[] | null> {
      const raw = await request(`${ws(wsId)}/chat/presence`, json("POST", { state: "online", visible }));
      return parseWithFallback<z.infer<typeof PresenceBeatSchema>>(raw, PresenceBeatSchema, {}, { endpoint: "POST /api/v1/workspaces/{ws}/chat/presence" }).online_user_ids ?? null;
    },
    leavePresence(wsId: string) {
      return ok(request(`${ws(wsId)}/chat/presence`, json("POST", { state: "offline" })), "POST /api/v1/workspaces/{ws}/chat/presence");
    },
    signalTyping(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/typing`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/typing");
    },
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;

export const chatApi: ChatApi = createChatApi((path, init) => api.request(path, init));
