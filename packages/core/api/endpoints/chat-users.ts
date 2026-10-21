import { request } from "../http";
import { createChatUsersApi } from "./chat-users-api";

// The web's binding of the shared chat user endpoints (chat-users-api.ts) to its transport.
export const {
  lookupChatUser,
  lookupChatUserById,
  getChatBlockStatus,
  blockChatUser,
  unblockChatUser,
  listChatNicknames,
  setChatNickname,
} = createChatUsersApi((path, opts) => request(path, opts));
