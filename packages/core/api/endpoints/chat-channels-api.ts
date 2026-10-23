import { parseWithFallback } from "../schema";
import { queryString, readRoom, readStatusOk } from "./chat-endpoint-kit";
import { ChatRoomsListSchema, enc } from "./chat-schemas";
import type { ChatRequest, ChatRoomRecord } from "./chat-schemas";

/**
 * The chat channel endpoints over any transport: chat-channels.ts binds them
 * to the web's, the phone (apps/chat-mobile, ADR 0011) to its own.
 */

export type CreateChatChannelInput = {
  name: string;
  visibility: "public" | "private" | string;
  topic?: string;
  project_id?: string;
  member_user_ids?: string[];
};

export type UpdateChatChannelInput = {
  name?: string;
  topic?: string;
  visibility?: string;
  /** Pass `null` to clear the project link. */
  project_id?: string | null;
};

export type ListChatChannelsOpts = {
  scope?: "mine" | "discoverable" | string;
  project_id?: string;
};

export function createChatChannelsApi(request: ChatRequest) {
  const ws = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}`;
  const channel = (workspaceId: string, roomId: string) => `${ws(workspaceId)}/chat/channels/${enc(roomId)}`;

  async function rooms(raw: Promise<unknown>, endpoint: string): Promise<ChatRoomRecord[]> {
    return parseWithFallback(await raw, ChatRoomsListSchema, { rooms: [] }, { endpoint }).rooms ?? [];
  }

  return {
    createChatChannel(workspaceId: string, input: CreateChatChannelInput): Promise<ChatRoomRecord | null> {
      return readRoom(request(`${ws(workspaceId)}/chat/channels`, { method: "POST", body: input }), "POST /api/v1/workspaces/{ws}/chat/channels");
    },

    listChatChannels(workspaceId: string, opts: ListChatChannelsOpts = {}): Promise<ChatRoomRecord[]> {
      const qs = queryString({ scope: opts.scope, project_id: opts.project_id });
      return rooms(request(`${ws(workspaceId)}/chat/channels${qs}`), "GET /api/v1/workspaces/{ws}/chat/channels");
    },

    updateChatChannel(workspaceId: string, roomId: string, input: UpdateChatChannelInput): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(channel(workspaceId, roomId), { method: "PATCH", body: input }),
        "PATCH /api/v1/workspaces/{ws}/chat/channels/{roomID}",
      );
    },

    joinChatChannel(workspaceId: string, roomId: string): Promise<ChatRoomRecord | null> {
      return readRoom(
        request(`${channel(workspaceId, roomId)}/join`, { method: "POST", body: {} }),
        "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/join",
      );
    },

    archiveChatChannel(workspaceId: string, roomId: string): Promise<boolean> {
      return readStatusOk(
        request(`${channel(workspaceId, roomId)}/archive`, { method: "POST", body: {} }),
        "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/archive",
      );
    },

    unarchiveChatChannel(workspaceId: string, roomId: string): Promise<boolean> {
      return readStatusOk(
        request(`${channel(workspaceId, roomId)}/archive`, { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/channels/{roomID}/archive",
      );
    },

    listProjectChatChannels(workspaceId: string, projectId: string): Promise<ChatRoomRecord[]> {
      return rooms(
        request(`${ws(workspaceId)}/projects/${enc(projectId)}/chat/channels`),
        "GET /api/v1/workspaces/{ws}/projects/{projectID}/chat/channels",
      );
    },
  };
}
