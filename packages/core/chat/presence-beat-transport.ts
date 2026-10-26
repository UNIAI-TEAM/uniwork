import { beatChatPresence } from "../api/endpoints/chat-presence";

export type PresenceBeatFn = (workspaceId: string, visible: boolean) => Promise<string[] | null>;

let beatFn: PresenceBeatFn | undefined;

/** Prefer WebSocket beats when bound (WSProvider); otherwise HTTP. */
export function setPresenceBeatTransport(fn: PresenceBeatFn | undefined): void {
  beatFn = fn;
}

export function beatPresence(workspaceId: string, visible: boolean): Promise<string[] | null> {
  if (beatFn) return beatFn(workspaceId, visible);
  return beatChatPresence(workspaceId, visible);
}
