import { createChatThreadsApi } from "./chat-threads-api";
import { webChatRequest } from "./chat-web-request";

export type { ChatThreadRecord } from "./chat-threads-api";

// The web's binding of the shared chat thread endpoints (chat-threads-api.ts) to its transport.
export const {
  listChatThreadMessages,
  sendChatThreadMessage,
  followChatThread,
  unfollowChatThread,
  markChatThreadRead,
  listFollowedChatThreads,
} = createChatThreadsApi(webChatRequest);
