import { renderHook } from "@testing-library/react-native";
import { createAudioPlayer } from "expo-audio";
import { Vibration } from "react-native";
import { nativeCalls } from "@/data/calls/native-calls";
import { useCallRingtone } from "./use-call-ringtone";

jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { available: true, startRinging: jest.fn(), stopRinging: jest.fn() } }));

const native = nativeCalls as unknown as { available: boolean; startRinging: jest.Mock; stopRinging: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  native.available = true;
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
});
