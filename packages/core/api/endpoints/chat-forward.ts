import { request } from "../http";
import { createChatForwardApi } from "./chat-forward-api";

export type { ForwardChatMessageInput } from "./chat-forward-api";

// The web's binding of the shared forward endpoint (chat-forward-api.ts) to its transport.
export const { forwardChatMessage } = createChatForwardApi((path, opts) => request(path, opts));
