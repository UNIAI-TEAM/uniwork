import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { createNativeCallSync, installNativeCallSync, type NativeCallSyncEnv } from "./call-native-sync";

const incoming: VoiceCallOverlayState = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" };
const connecting: VoiceCallOverlayState = { status: "connecting", callId: "c-1", roomId: "r-1", peerName: "Minh", outgoing: false, callKind: "dm" };
const active: VoiceCallOverlayState = { ...connecting, status: "active", token: "t", url: "wss://lk" };
const ended: VoiceCallOverlayState = { status: "ended", reason: "peer_ended", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm", outgoing: false };
const idle: VoiceCallOverlayState = { status: "idle" };

function setup(over: Partial<NativeCallSyncEnv> = {}) {
  let now = 1_000;
  const env: NativeCallSyncEnv = {
    native: { cancelIncomingCall: vi.fn(), startOngoingCall: vi.fn(() => true), stopOngoingCall: vi.fn(), releaseLockScreen: vi.fn() },
    requestBluetooth: vi.fn(async () => undefined),
    workspaceId: () => "w-1",
    t: (key) => key,
    now: () => now,
    ...over,
  };
  const store = createStore<{ call: VoiceCallOverlayState }>(() => ({ call: idle }));
  const sync = createNativeCallSync(env);
  const stop = installNativeCallSync(store, sync);
  return {
    env,
    sync,
    stop,
    set: (call: VoiceCallOverlayState) => store.setState({ call }),
    tick: (ms: number) => (now += ms),
  };
}

describe("native call sync", () => {
  it("says on the ongoing notification while the media link reconnects, and forgets it with the call", () => {
    const { env, sync, set } = setup();
    set(connecting);
    set(active);
    sync.setReconnecting(true, active);
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ text: "chat.voice_call_reconnecting" }));
    // The same news twice posts once.
    sync.setReconnecting(true, active);
    expect(env.native.startOngoingCall).toHaveBeenCalledTimes(3);
    sync.setReconnecting(false, active);
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ text: "mobile.call_notify.ongoing_voice" }));
    // A drop with no call under way (or another call's) only remembers it; the call ending forgets it.
    sync.setReconnecting(true, idle);
    expect(env.native.startOngoingCall).toHaveBeenCalledTimes(4);
    set(ended);
    set({ ...connecting, callId: "c-2" });
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: "c-2", text: "chat.voice_call_connecting" }));
  });

  it("runs the foreground service from connecting to the end of the call", () => {
    const { env, set, tick } = setup();
    set(incoming);
    // The call screen rings it: the ringing notification of the same call goes.
    expect(env.native.cancelIncomingCall).toHaveBeenCalledWith("c-1");
    set(connecting);
    expect(env.requestBluetooth).toHaveBeenCalledTimes(1);
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith({
      callId: "c-1",
      roomId: "r-1",
      workspaceId: "w-1",
      peerName: "Minh",
      text: "chat.voice_call_connecting",
      video: false,
      startedAt: 0,
    });
    tick(500);
    set(active);
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ text: "mobile.call_notify.ongoing_voice", startedAt: 1_500 }));
    // The same state again (a re-render's setState) starts nothing new.
    set({ ...active });
    expect(env.native.startOngoingCall).toHaveBeenCalledTimes(2);
    set(ended);
    expect(env.native.stopOngoingCall).toHaveBeenCalledTimes(1);
    expect(env.native.releaseLockScreen).toHaveBeenCalledTimes(1);
    // The ended panel changing its reason is no new state for the phone.
    set({ ...ended, reason: "declined" });
    expect(env.native.releaseLockScreen).toHaveBeenCalledTimes(1);
    set(idle);
    expect(env.native.stopOngoingCall).toHaveBeenCalledTimes(1);
    expect(env.native.releaseLockScreen).toHaveBeenCalledTimes(2);
    expect(env.requestBluetooth).toHaveBeenCalledTimes(1);
  });

  it("names a video call and asks for Bluetooth again for the next call", () => {
    const { env, set } = setup({ requestBluetooth: vi.fn(async () => Promise.reject(new Error("denied"))) });
    set({ ...active, withCamera: true });
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ video: true, text: "mobile.call_notify.ongoing_video" }));
    set({ ...connecting, callId: "c-2" });
    expect(env.requestBluetooth).toHaveBeenCalledTimes(2);
    expect(env.native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: "c-2", startedAt: 0 }));
  });

  it("takes a ring that ended unanswered off the lock screen, with no service to stop", () => {
    const { env, set } = setup();
    set(incoming);
    set({ ...ended, reason: "missed" });
    expect(env.native.cancelIncomingCall).toHaveBeenLastCalledWith("c-1");
    expect(env.native.stopOngoingCall).not.toHaveBeenCalled();
    expect(env.native.releaseLockScreen).toHaveBeenCalledTimes(1);
  });

  it("an outgoing call that rings needs no service yet", () => {
    const { env, set } = setup();
    set({ status: "ringing", callId: "c-3", roomId: "r", peerName: "Lan", outgoing: true, callKind: "dm" });
    expect(env.native.startOngoingCall).not.toHaveBeenCalled();
    expect(env.native.releaseLockScreen).not.toHaveBeenCalled();
  });

  it("refresh() starts the service of the live call again, and nothing otherwise", () => {
    const { env, set, sync, stop } = setup();
    sync.refresh(active);
    expect(env.native.startOngoingCall).not.toHaveBeenCalled();
    set(active);
    sync.refresh(active);
    sync.refresh({ ...active, callId: "other" });
    expect(env.native.startOngoingCall).toHaveBeenCalledTimes(2);
    stop();
    set(idle);
    expect(env.native.stopOngoingCall).not.toHaveBeenCalled();
  });
});
