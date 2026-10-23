// Keeps the native side of a call in step with the call engine
// (call-engine.ts), so no screen has to (docs/adr/drafts/0038):
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
// - the media link dropped and LiveKit reconnecting (components/calls/
//   use-call-link.ts): the ongoing notification says so until it is back.
//
// - any call the engine holds (incoming, ringing, connecting, active): the
//   native ring path is told (setCallEngineLive), so a call push that lands
//   while the app is behind goes to JavaScript, which answers a 1-1 caller
//   busy (call-push.ts › handleCallPush), instead of ringing a second call
//   over an outgoing one still ringing. Written at install too: a reloaded
//   bundle must not leave the last runtime's mark.
//
// Nothing here ends a call or reads the calls switch: a call already under
// way keeps its service when the switch is turned off.
import type { StoreApi } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { NativeCalls, NativeOngoingCall } from "./native-calls";
import { bestEffort } from "../report";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type InCall = Extract<VoiceCallOverlayState, { status: "connecting" | "active" }>;

export interface NativeCallSyncEnv {
  native: Pick<NativeCalls, "cancelIncomingCall" | "startOngoingCall" | "stopOngoingCall" | "releaseLockScreen" | "setCallEngineLive">;
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
  let reconnecting = false;
  let liveWritten: boolean | null = null;

  /** The engine holds a call (call-push.ts › liveCallId): the native ring path defers to JavaScript. */
  function markLive(state: VoiceCallOverlayState): void {
    const live = state.status !== "idle" && state.status !== "ended";
    if (live === liveWritten) return;
    liveWritten = live;
    env.native.setCallEngineLive(live);
  }

  function line(state: InCall, video: boolean): string {
    if (reconnecting) return env.t("chat.voice_call_reconnecting");
    if (state.status === "connecting") return env.t("chat.voice_call_connecting");
    return env.t(video ? "mobile.call_notify.ongoing_video" : "mobile.call_notify.ongoing_voice");
  }

  function ongoing(state: InCall): NativeOngoingCall {
    const video = state.withCamera ?? false;
    return {
      callId: state.callId,
      roomId: state.roomId,
      workspaceId: env.workspaceId(),
      peerName: state.peerName,
      text: line(state, video),
      video,
      startedAt: connectedAt,
    };
  }

  function apply(next: VoiceCallOverlayState, prev: VoiceCallOverlayState): void {
    markLive(next);
    if (next.status === "incoming") env.native.cancelIncomingCall(next.callId);
    if (inCall(next)) {
      if (callId !== next.callId) {
        callId = next.callId;
        connectedAt = 0;
        reconnecting = false;
        void env.requestBluetooth().catch(bestEffort("calls", "bluetooth permission not asked", "breadcrumb"));
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
      reconnecting = false;
      env.native.stopOngoingCall();
    }
    if (next.status === "idle" || next.status === "ended") env.native.releaseLockScreen();
  }

  return {
    apply,
    markLive,
    /** The call's service again: LiveKit now holds the microphone (the service's microphone type needs it granted). */
    refresh(state: VoiceCallOverlayState): void {
      if (inCall(state) && state.callId === callId) env.native.startOngoingCall(ongoing(state));
    },
    /** The media link dropped (true) or came back (false): the ongoing notification follows. */
    setReconnecting(on: boolean, state: VoiceCallOverlayState): void {
      if (on === reconnecting) return;
      reconnecting = on;
      if (inCall(state) && state.callId === callId) env.native.startOngoingCall(ongoing(state));
    },
  };
}

export type NativeCallSync = ReturnType<typeof createNativeCallSync>;

/** Runs the sync on every change of the engine's call; the function it returns stops it. */
export function installNativeCallSync(store: StoreApi<{ call: VoiceCallOverlayState }>, sync: NativeCallSync): () => void {
  sync.markLive(store.getState().call);
  return store.subscribe((state, previous) => sync.apply(state.call, previous.call));
}
