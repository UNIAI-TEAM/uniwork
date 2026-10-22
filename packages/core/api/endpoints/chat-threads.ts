import { request } from "../http";
import { createChatThreadsApi } from "./chat-threads-api";

export type { ChatThreadRecord } from "./chat-threads-api";

// The web's binding of the shared chat thread endpoints (chat-threads-api.ts) to its transport.
export const {
  listChatThreadMessages,
  sendChatThreadMessage,
  followChatThread,
  unfollowChatThread,
  markChatThreadRead,
  listFollowedChatThreads,
} = createChatThreadsApi((path, opts) => request(path, opts));
