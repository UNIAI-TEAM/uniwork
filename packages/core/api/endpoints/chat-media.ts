import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { ChatGifItemSchema, ChatGifListSchema, ChatMediaStatusSchema, enc } from "./chat-schemas";
import type { ChatGifRecord } from "./chat-schemas";

function mapChatGifRecord(raw: z.infer<typeof ChatGifItemSchema>): ChatGifRecord {
  return {
    id: raw.id,
    label: raw.label,
    url: raw.url,
    previewUrl: raw.preview_url?.trim() || raw.url,
  };
}

export async function searchChatGifs(
  workspaceId: string,
  query: string,
  limit = 48,
): Promise<ChatGifRecord[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/gifs/search?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, ChatGifListSchema, { items: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/gifs/search",
  });
  return (parsed.items ?? []).map(mapChatGifRecord);
}

export async function listTrendingChatGifs(
  workspaceId: string,
  limit = 48,
): Promise<ChatGifRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/gifs/trending?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, ChatGifListSchema, { items: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/gifs/trending",
  });
  return (parsed.items ?? []).map(mapChatGifRecord);
}

export async function searchChatStickers(
  workspaceId: string,
  query: string,
  limit = 48,
): Promise<ChatGifRecord[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/stickers/search?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, ChatGifListSchema, { items: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/stickers/search",
  });
  return (parsed.items ?? []).map(mapChatGifRecord);
}

export async function listTrendingChatStickers(
  workspaceId: string,
  limit = 48,
): Promise<ChatGifRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/stickers/trending?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, ChatGifListSchema, { items: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/stickers/trending",
  });
  return (parsed.items ?? []).map(mapChatGifRecord);
}

export async function getChatMediaStatus(workspaceId: string): Promise<{ tenorEnabled: boolean }> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/media/status`);
  const parsed = parseWithFallback(raw, ChatMediaStatusSchema, { tenor_enabled: false }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/media/status",
  });
  return { tenorEnabled: parsed.tenor_enabled ?? false };
}

const ChatSharedPhotoSchema = z.object({
  message_id: z.string(),
  file_id: z.string().optional().catch(undefined),
  title: z.string().catch(""),
  url: z.string().optional().catch(undefined),
  thumb_url: z.string().optional().catch(undefined),
  url_expires_at: z.string().optional().catch(undefined),
  created_at: z.string().catch(""),
});

const count = z.number().int().nonnegative().catch(0);

const ChatRoomSharedSummarySchema = z.object({
  counts: z
    .object({ photo: count, gif: count, video: count, file: count, link: count, voice: count })
    .catch({ photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }),
  recent_photos: z.array(ChatSharedPhotoSchema).catch([]),
});

/** A room's shared-media counts and its newest photos (at most 6, newest first). */
type ChatRoomSharedSummary = z.infer<typeof ChatRoomSharedSummarySchema>;

const EMPTY_SHARED_SUMMARY: ChatRoomSharedSummary = {
  counts: { photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 },
  recent_photos: [],
};

export async function getChatRoomSharedSummary(
  workspaceId: string,
  roomId: string,
): Promise<ChatRoomSharedSummary> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/shared-summary`,
  );
  return parseWithFallback(raw, ChatRoomSharedSummarySchema, EMPTY_SHARED_SUMMARY, {
    endpoint: "GET .../chat/rooms/{roomID}/shared-summary",
  });
}
