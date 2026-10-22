import { createChatUsersApi } from "./chat-users-api";
import { webChatRequest } from "./chat-web-request";

// The web's binding of the shared chat user endpoints (chat-users-api.ts) to its transport.
export const {
  lookupChatUser,
  lookupChatUserById,
  getChatBlockStatus,
  blockChatUser,
  unblockChatUser,
  listChatNicknames,
  setChatNickname,
} = createChatUsersApi(webChatRequest);
