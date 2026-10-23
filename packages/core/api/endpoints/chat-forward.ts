import { createChatForwardApi } from "./chat-forward-api";
import { webChatRequest } from "./chat-web-request";

export type { ForwardChatMessageInput } from "./chat-forward-api";

// The web's binding of the shared forward endpoint (chat-forward-api.ts) to its transport.
export const { forwardChatMessage } = createChatForwardApi(webChatRequest);
