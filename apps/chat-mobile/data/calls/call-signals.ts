// The call signals the phone sends beyond what data/chat-api.ts binds (that file is a copy of the web's, held by
// the copies ratchet: web-copies.json): Decline, through the shared core factory over the app's transport. A
// 1-1 call ends; a group or channel call goes on without the person and stops ringing on their other devices.
import { createChatVoiceApi } from "@uniwork/core/api/endpoints/chat-voice-api";
import { api } from "../api";
import { toChatRequest } from "../chat-api";

type Request = Parameters<typeof toChatRequest>[0];

export function createCallSignals(request: Request) {
  const voice = createChatVoiceApi(toChatRequest(request));
  return {
    /** True once the server took it; false on an answer it cannot read (it degrades, never throws). */
    decline: (wsId: string, roomId: string, callId: string): Promise<boolean> => voice.signalChatVoiceDecline(wsId, roomId, callId),
  };
}

export const callSignals = createCallSignals((path, init) => api.request(path, init));
