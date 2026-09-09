import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import {
  ChatRoomEnvelopeSchema,
  ChatRoomsListSchema,
  enc,
} from "./chat-schemas";
import type { ChatRoomRecord } from "./chat-schemas";

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

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
  q?: string;
};

export async function createChatChannel(
  workspaceId: string,
  input: CreateChatChannelInput,
): Promise<ChatRoomRecord | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/channels`, {
    method: "POST",
    body: input,
  });
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/channels",
  });
  return parsed.room ?? null;
}

export async function listChatChannels(
  workspaceId: string,
  opts: ListChatChannelsOpts = {},
): Promise<ChatRoomRecord[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/channels${qs({
      scope: opts.scope,
      project_id: opts.project_id,
      q: opts.q,
    })}`,
  );
  const parsed = parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/channels",
  });
  return parsed.rooms ?? [];
}

export async function updateChatChannel(
  workspaceId: string,
  roomId: string,
  input: UpdateChatChannelInput,
): Promise<ChatRoomRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/channels/${enc(roomId)}`,
    { method: "PATCH", body: input },
  );
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/chat/channels/{roomID}",
  });
  return parsed.room ?? null;
}

export async function joinChatChannel(
  workspaceId: string,
  roomId: string,
): Promise<ChatRoomRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/channels/${enc(roomId)}/join`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, ChatRoomEnvelopeSchema, { room: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/join",
  });
  return parsed.room ?? null;
}

export async function archiveChatChannel(
  workspaceId: string,
  roomId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/channels/${enc(roomId)}/archive`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/archive",
  });
  return parsed.status === "ok";
}

export async function unarchiveChatChannel(
  workspaceId: string,
  roomId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/channels/${enc(roomId)}/archive`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/chat/channels/{roomID}/archive",
  });
  return parsed.status === "ok";
}

export async function listProjectChatChannels(
  workspaceId: string,
  projectId: string,
): Promise<ChatRoomRecord[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/chat/channels`,
  );
  const parsed = parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects/{projectID}/chat/channels",
  });
  return parsed.rooms ?? [];
}
