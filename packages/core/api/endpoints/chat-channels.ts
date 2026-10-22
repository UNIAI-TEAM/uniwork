import { request } from "../http";
import { createChatChannelsApi } from "./chat-channels-api";

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
} = createChatChannelsApi((path, opts) => request(path, opts));
