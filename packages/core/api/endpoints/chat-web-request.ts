import { request } from "../http";
import type { ChatRequest } from "./chat-schemas";

/**
 * The web's transport as the chat endpoint factories (chat-*-api.ts) take it.
 * A call made without options stays a one-argument call, as it was before the
 * factories, so nothing downstream sees an explicit `undefined`.
 */
export const webChatRequest: ChatRequest = (path, opts) => (opts ? request(path, opts) : request(path));
