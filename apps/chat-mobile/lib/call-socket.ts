// Whether a call needs the workspace socket while the app is in the
// background (audit C1): a ringing call waits for the peer's accept or
// decline, an incoming one for the caller's hang-up, and a connecting or live
// one for the other side's hang-up. Pausing the socket then made the caller
// miss chat.voice.accept and ring out after 45 s. An ended or idle call needs
// nothing; data/realtime/realtime-provider.tsx pauses as usual.
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";

export function callHoldsSocket(state: VoiceCallOverlayState): boolean {
  return state.status === "incoming" || state.status === "ringing" || state.status === "connecting" || state.status === "active";
}
