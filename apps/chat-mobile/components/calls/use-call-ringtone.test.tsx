import { renderHook } from "@testing-library/react-native";
import { createAudioPlayer } from "expo-audio";
import { Vibration } from "react-native";
import { nativeCallSession } from "@/data/calls/native-call-session";
import { nativeCalls } from "@/data/calls/native-calls";
import { useCallRingtone } from "./use-call-ringtone";

jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { available: true, startRinging: jest.fn(), stopRinging: jest.fn() } }));
jest.mock("@/data/calls/native-call-session", () => ({ nativeCallSession: { ringing: jest.fn(() => false) } }));

const native = nativeCalls as unknown as { available: boolean; startRinging: jest.Mock; stopRinging: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  native.available = true;
  jest.mocked(nativeCallSession.ringing).mockReturnValue(false);
});

describe("useCallRingtone", () => {
  it("rings an incoming call on Android with the phone's ringtone, not the media player", async () => {
    const hook = await renderHook(({ kind }: { kind: "incoming" | null }) => useCallRingtone(kind), { initialProps: { kind: "incoming" } });
    expect(native.startRinging).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    await hook.rerender({ kind: null });
    expect(native.stopRinging).toHaveBeenCalledTimes(1);
  });

  it("plays the caller's ringback, and an incoming ring where the native ringer is missing", async () => {
    const outgoing = await renderHook(() => useCallRingtone("outgoing"));
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(native.startRinging).not.toHaveBeenCalled();
    await outgoing.unmount();
    native.available = false;
    await renderHook(() => useCallRingtone("incoming"));
    expect(createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(Vibration.vibrate).toHaveBeenCalled();
  });

  // docs/adr/0038: a VoIP push already rings the call through CallKit, with the phone's ringtone and its switches.
  it("adds no ring of its own to a call the system's call UI rings, and still plays the caller's ringback", async () => {
    native.available = false;
    jest.mocked(nativeCallSession.ringing).mockReturnValue(true);
    await renderHook(() => useCallRingtone("incoming"));
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    await renderHook(() => useCallRingtone("outgoing"));
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });
});
