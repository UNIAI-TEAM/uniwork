import type { ChatRequest } from "./chat-schemas";
import { webRequest } from "./web-request";

/** The web's transport as the chat endpoint factories (chat-*-api.ts) take it: the one web binding, web-request.ts. */
export const webChatRequest: ChatRequest = webRequest;
