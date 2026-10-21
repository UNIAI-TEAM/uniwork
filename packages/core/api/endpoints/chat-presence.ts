import { request } from "../http";
import { createChatPresenceApi } from "./chat-presence-api";

// The web's binding of the shared presence heartbeat (chat-presence-api.ts) to its transport.
export const { beatChatPresence } = createChatPresenceApi((path, opts) => request(path, opts));
