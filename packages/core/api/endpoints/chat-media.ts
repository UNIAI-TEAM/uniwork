import { createChatMediaApi } from "./chat-media-api";
import { webChatRequest } from "./chat-web-request";

// The web's binding of the shared chat media endpoints (chat-media-api.ts) to its transport.
export const {
  searchChatGifs,
  listTrendingChatGifs,
  searchChatStickers,
  listTrendingChatStickers,
  getChatMediaStatus,
  getChatRoomSharedSummary,
} = createChatMediaApi(webChatRequest);
