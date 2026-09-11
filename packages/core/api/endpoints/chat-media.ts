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
