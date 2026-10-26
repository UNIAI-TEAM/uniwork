import { createChatChannelsApi } from "./chat-channels-api";
import { webChatRequest } from "./chat-web-request";

export type { CreateChatChannelInput, ListChatChannelsOpts, UpdateChatChannelInput } from "./chat-channels-api";

// The web's binding of the shared chat channel endpoints (chat-channels-api.ts) to its transport.
export const {
  createChatChannel,
  listChatChannels,
  updateChatChannel,
  joinChatChannel,
  archiveChatChannel,
  unarchiveChatChannel,
  listProjectChatChannels,
} = createChatChannelsApi(webChatRequest);
