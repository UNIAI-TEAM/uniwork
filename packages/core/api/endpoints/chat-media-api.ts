import type { z } from "zod";
import { parseWithFallback } from "../schema";
import {
  ChatGifListSchema,
  ChatMediaStatusSchema,
  ChatRoomSharedSummarySchema,
  EMPTY_SHARED_SUMMARY,
  enc,
  type ChatGifItemSchema,
} from "./chat-schemas";
import type { ChatGifRecord, ChatRequest, ChatRoomSharedSummary } from "./chat-schemas";

/**
 * The chat media endpoints (GIF and sticker pickers, a room's shared media)
 * over any transport: chat-media.ts binds them to the web's, the phone
 * (apps/chat-mobile, ADR 0011) to its own.
 */

export type ChatExpressionKind = "gifs" | "stickers";

function toGifRecord(raw: z.infer<typeof ChatGifItemSchema>): ChatGifRecord {
  return { id: raw.id, label: raw.label, url: raw.url, previewUrl: raw.preview_url?.trim() || raw.url };
}

export function createChatMediaApi(request: ChatRequest) {
  const ws = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}`;

  async function expressions(workspaceId: string, kind: ChatExpressionKind, params: URLSearchParams): Promise<ChatGifRecord[]> {
    const mode = params.has("q") ? "search" : "trending";
    const raw = await request(`${ws(workspaceId)}/chat/${kind}/${mode}?${params.toString()}`);
    const parsed = parseWithFallback(raw, ChatGifListSchema, { items: [] }, {
      endpoint: `GET /api/v1/workspaces/{ws}/chat/${kind}/${mode}`,
    });
    return (parsed.items ?? []).map(toGifRecord);
  }

  return {
    searchChatGifs(workspaceId: string, query: string, limit = 48): Promise<ChatGifRecord[]> {
      return expressions(workspaceId, "gifs", new URLSearchParams({ q: query, limit: String(limit) }));
    },

    listTrendingChatGifs(workspaceId: string, limit = 48): Promise<ChatGifRecord[]> {
      return expressions(workspaceId, "gifs", new URLSearchParams({ limit: String(limit) }));
    },

    searchChatStickers(workspaceId: string, query: string, limit = 48): Promise<ChatGifRecord[]> {
      return expressions(workspaceId, "stickers", new URLSearchParams({ q: query, limit: String(limit) }));
    },

    listTrendingChatStickers(workspaceId: string, limit = 48): Promise<ChatGifRecord[]> {
      return expressions(workspaceId, "stickers", new URLSearchParams({ limit: String(limit) }));
    },

    async getChatMediaStatus(workspaceId: string): Promise<{ tenorEnabled: boolean }> {
      const raw = await request(`${ws(workspaceId)}/chat/media/status`);
      const parsed = parseWithFallback(raw, ChatMediaStatusSchema, { tenor_enabled: false }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/media/status",
      });
      return { tenorEnabled: parsed.tenor_enabled ?? false };
    },

    /** What a room has shared, for its info screen; the empty summary when the answer drifted. */
    async getChatRoomSharedSummary(workspaceId: string, roomId: string, signal?: AbortSignal): Promise<ChatRoomSharedSummary> {
      const path = `${ws(workspaceId)}/chat/rooms/${enc(roomId)}/shared-summary`;
      const raw = await (signal ? request(path, { signal }) : request(path));
      return parseWithFallback(raw, ChatRoomSharedSummarySchema, EMPTY_SHARED_SUMMARY, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/shared-summary",
      });
    },
  };
}
