// The app's one call engine, wired to the chat API; the logic is call-engine.ts.
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { useStore } from "zustand";
import { chatApi } from "@/data/chat-api";
import { createCallEngine } from "./call-engine";

const hangupListeners = new Set<(wsId: string) => void>();

/** Called once each hangup this phone sends has been answered (or failed): the server wrote the call's log by then. */
export function onHangupSettled(listener: (wsId: string) => void): () => void {
  hangupListeners.add(listener);
  return () => void hangupListeners.delete(listener);
}

export const callEngine = createCallEngine({
  invite: chatApi.signalVoiceInvite,
  accept: chatApi.signalVoiceAccept,
  hangup: (wsId, roomId, callId, durationSeconds) =>
    chatApi.signalVoiceHangup(wsId, roomId, callId, durationSeconds).finally(() => {
      for (const listener of hangupListeners) listener(wsId);
    }),
  pending: chatApi.listPendingVoiceInvites,
  outgoing: chatApi.listOutgoingVoiceCalls,
  mintToken: chatApi.mintVoiceToken,
  // A UUID where the runtime has one, else letters, digits and '-': both pass the server's call_id check.
  createCallId: newChatClientMsgId,
});

export function useVoiceCall() {
  return useStore(callEngine.store, (s) => s.call);
}
