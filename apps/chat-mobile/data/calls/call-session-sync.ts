// The call engine (call-engine.ts) tells the system's call UI (native-call-session.ts) what became of a call, so a
// call answered, declined or ended in the app does not stay on the system's screens (docs/adr/0038):
//
// - an incoming call that starts connecting was answered here: `answered` (CallKit answers it too, and so activates
//   the call's audio; Android's ringing notification goes);
// - an incoming call that stops being live (declined, rung out, taken on another device): `declined`;
// - any other live call that stops being live, or gives way to another call: `ended`.
//
// The system's own Answer, Decline and End come the other way (call-session.ts). A call the system never heard of
// (it rang only in the app) is the session's to ignore.
import type { StoreApi } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { NativeCallSession } from "./native-call-session";

type Live = Exclude<VoiceCallOverlayState, { status: "idle" } | { status: "ended" }>;

function live(state: VoiceCallOverlayState): Live | null {
  return state.status === "idle" || state.status === "ended" ? null : state;
}

type SessionSide = Pick<NativeCallSession, "answered" | "declined" | "ended">;

export function syncCallSession(session: SessionSide, next: VoiceCallOverlayState, prev: VoiceCallOverlayState): void {
  const before = live(prev);
  if (!before) return;
  const after = live(next);
  if (after?.callId === before.callId) {
    if (before.status === "incoming" && after.status !== "incoming") session.answered(before.callId);
    return;
  }
  if (before.status === "incoming") session.declined(before.callId);
  else session.ended(before.callId);
}

/** Runs the sync on every change of the engine's call; the function it returns stops it. */
export function installCallSessionSync(store: StoreApi<{ call: VoiceCallOverlayState }>, session: NativeCallSession): () => void {
  return store.subscribe((state, previous) => syncCallSession(session, state.call, previous.call));
}
