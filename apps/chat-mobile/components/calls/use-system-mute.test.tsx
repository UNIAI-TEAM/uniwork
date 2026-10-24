// CallKit's mute button (use-system-mute.ts) on a stand-in room: it mutes and unmutes the microphone once the call
// is connected, ignores the session's other events, and stops listening when the call goes.
import { act, renderHook } from "@testing-library/react-native";
import type { Room } from "livekit-client";
import { useSystemMute } from "./use-system-mute";

type Listener = (event: { type: string; callId?: string; muted?: boolean; held?: boolean }) => void;
const mockSession: { listener: Listener | null; off: jest.Mock } = { listener: null, off: jest.fn() };
jest.mock("@/data/calls/native-call-session", () => ({
  nativeCallSession: {
    subscribe: (listener: Listener) => {
      mockSession.listener = listener;
      return mockSession.off;
    },
  },
}));
const mockReport = jest.fn();
jest.mock("@/data/report", () => ({ bestEffort: () => mockReport }));

function fakeRoom() {
  const setMicrophoneEnabled = jest.fn(async (_on: boolean) => undefined);
  return { room: { localParticipant: { setMicrophoneEnabled } } as unknown as Room, setMicrophoneEnabled };
}

beforeEach(() => {
  mockSession.listener = null;
  jest.clearAllMocks();
});

describe("useSystemMute", () => {
  it("does not listen before the call connects", async () => {
    await renderHook(() => useSystemMute(fakeRoom().room, false));
    expect(mockSession.listener).toBeNull();
  });

  it("mutes and unmutes the microphone from the system's button, and nothing else moves it", async () => {
    const { room, setMicrophoneEnabled } = fakeRoom();
    const hook = await renderHook(() => useSystemMute(room, true));
    await act(async () => {
      mockSession.listener?.({ type: "muted", callId: "c-1", muted: true });
      mockSession.listener?.({ type: "held", callId: "c-1", held: true });
      mockSession.listener?.({ type: "muted", callId: "c-1", muted: false });
    });
    expect(setMicrophoneEnabled.mock.calls).toEqual([[false], [true]]);
    await hook.unmount();
    expect(mockSession.off).toHaveBeenCalledTimes(1);
  });

  it("reports a microphone that would not follow", async () => {
    const { room, setMicrophoneEnabled } = fakeRoom();
    setMicrophoneEnabled.mockRejectedValueOnce(new Error("no device"));
    await renderHook(() => useSystemMute(room, true));
    await act(async () => {
      mockSession.listener?.({ type: "muted", callId: "c-1", muted: true });
    });
    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
