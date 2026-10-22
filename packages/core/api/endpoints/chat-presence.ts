import { createChatPresenceApi } from "./chat-presence-api";
import { webChatRequest } from "./chat-web-request";

// The web's binding of the shared presence heartbeat (chat-presence-api.ts) to its transport.
export const { beatChatPresence } = createChatPresenceApi(webChatRequest);
