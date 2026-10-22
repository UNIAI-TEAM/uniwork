import { request } from "../http";
import { createChatMediaApi } from "./chat-media-api";

// The web's binding of the shared chat media endpoints (chat-media-api.ts) to its transport.
export const {
  searchChatGifs,
  listTrendingChatGifs,
  searchChatStickers,
  listTrendingChatStickers,
  getChatMediaStatus,
  getChatRoomSharedSummary,
} = createChatMediaApi((path, opts) => request(path, opts));
