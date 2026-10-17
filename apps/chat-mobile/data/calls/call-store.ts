// The app's one call engine, wired to the chat API; the logic is call-engine.ts.
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { useStore } from "zustand";
import { chatApi } from "@/data/chat-api";
import { createCallEngine } from "./call-engine";

export const callEngine = createCallEngine({
  invite: chatApi.signalVoiceInvite,
  accept: chatApi.signalVoiceAccept,
  hangup: chatApi.signalVoiceHangup,
  pending: chatApi.listPendingVoiceInvites,
  mintToken: chatApi.mintVoiceToken,
  // A UUID where the runtime has one, else letters, digits and '-': both pass the server's call_id check.
  createCallId: newChatClientMsgId,
});

export function useVoiceCall() {
  return useStore(callEngine.store, (s) => s.call);
}
