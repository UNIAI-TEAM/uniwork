// Keeps the native side of a call in step with the call engine
// (call-engine.ts), so no screen has to (audit P0-5, docs/adr/drafts/0038):
//
// - connecting or active: the call's foreground service runs, with its
//   ongoing notification (who, how long, Hang up), so a locked phone keeps
//   the microphone and the process; it starts again when the call connects
//   (the clock) and on refresh() once LiveKit holds the microphone.
// - the first connecting state of a call asks for Bluetooth (Android 12+), so
//   a headset can carry it.
// - ringing in the call screen: the ringing notification of the same call
//   goes (the screen and its own ringtone take over).
// - the call over: the service stops, any ringing notification goes, and the
//   activity no longer shows over the lock screen.
//
// Nothing here ends a call or reads the calls switch: a call already under
// way keeps its service when the switch is turned off.
import type { StoreApi } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { NativeCalls, NativeOngoingCall } from "./native-calls";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type InCall = Extract<VoiceCallOverlayState, { status: "connecting" | "active" }>;

export interface NativeCallSyncEnv {
  native: Pick<NativeCalls, "cancelIncomingCall" | "startOngoingCall" | "stopOngoingCall" | "releaseLockScreen">;
  /** Android 12+: asks for BLUETOOTH_CONNECT once per call; elsewhere resolves at once. */
  requestBluetooth: () => Promise<unknown>;
  /** The workspace of the call (the engine's), for the Hang up action. */
  workspaceId: () => string;
  t: Translate;
  now: () => number;
}

function inCall(state: VoiceCallOverlayState): state is InCall {
  return state.status === "connecting" || state.status === "active";
}

function callIdOf(state: VoiceCallOverlayState): string | undefined {
  return state.status === "idle" ? undefined : state.callId;
}

export function createNativeCallSync(env: NativeCallSyncEnv) {
  let callId: string | null = null;
  let connectedAt = 0;

  function ongoing(state: InCall): NativeOngoingCall {
    const video = state.withCamera ?? false;
    return {
      callId: state.callId,
      roomId: state.roomId,
      workspaceId: env.workspaceId(),
      peerName: state.peerName,
      text: state.status === "connecting" ? env.t("chat.voice_call_connecting") : env.t(video ? "mobile.call_notify.ongoing_video" : "mobile.call_notify.ongoing_voice"),
      video,
      startedAt: connectedAt,
    };
  }

  function apply(next: VoiceCallOverlayState, prev: VoiceCallOverlayState): void {
    if (next.status === "incoming") env.native.cancelIncomingCall(next.callId);
    if (inCall(next)) {
      if (callId !== next.callId) {
        callId = next.callId;
        connectedAt = 0;
        void env.requestBluetooth().catch(() => undefined);
      }
      if (next.status === "active" && !connectedAt) connectedAt = env.now();
      if (next.status !== prev.status || callIdOf(prev) !== next.callId) env.native.startOngoingCall(ongoing(next));
      return;
    }
    if (next.status === prev.status) return;
    const prevId = callIdOf(prev);
    if (prevId && prev.status === "incoming") env.native.cancelIncomingCall(prevId);
    if (callId !== null) {
      callId = null;
      connectedAt = 0;
      env.native.stopOngoingCall();
    }
    if (next.status === "idle" || next.status === "ended") env.native.releaseLockScreen();
  }

  return {
    apply,
    /** The call's service again: LiveKit now holds the microphone (the service's microphone type needs it granted). */
    refresh(state: VoiceCallOverlayState): void {
      if (inCall(state) && state.callId === callId) env.native.startOngoingCall(ongoing(state));
    },
  };
}

export type NativeCallSync = ReturnType<typeof createNativeCallSync>;

/** Runs the sync on every change of the engine's call; the function it returns stops it. */
export function installNativeCallSync(store: StoreApi<{ call: VoiceCallOverlayState }>, sync: NativeCallSync): () => void {
  return store.subscribe((state, previous) => sync.apply(state.call, previous.call));
}
