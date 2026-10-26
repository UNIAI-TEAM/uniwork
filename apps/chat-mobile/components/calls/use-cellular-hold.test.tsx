// The phone's own call holding a UniChat call (use-cellular-hold.ts) on a stand-in room: the microphone off and the
// others silent while the phone's call has the line, someone who joins meanwhile silent too, and both back when the
// line is given back — the microphone only if it was on, and never on a room already gone.
import { act, renderHook } from "@testing-library/react-native";
import type { Room } from "livekit-client";
import { nativeCallSession } from "@/data/calls/native-call-session";
import { useCellularHold } from "./use-cellular-hold";

jest.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected", Disconnected: "disconnected" },
  RoomEvent: { ParticipantConnected: "participantConnected" },
}));

let mockListener: (event: { type: string; callId?: string; held?: boolean; muted?: boolean }) => void = () => undefined;
const mockUnsubscribe = jest.fn();
jest.mock("@/data/calls/native-call-session", () => ({
  nativeCallSession: {
    isHeld: jest.fn(() => false),
    subscribe: jest.fn((listener: typeof mockListener) => {
      mockListener = listener;
      return mockUnsubscribe;
    }),
  },
}));

interface FakeParticipant {
  setVolume: jest.Mock;
}
type Handler = (participant: FakeParticipant) => void;

function fakeRoom(micOn = true) {
  const handlers = new Set<Handler>();
  const peer: FakeParticipant = { setVolume: jest.fn() };
  const late: FakeParticipant = { setVolume: jest.fn() };
  const participants = new Map<string, FakeParticipant>([["p1", peer]]);
  const room = {
    state: "connected",
    localParticipant: { isMicrophoneEnabled: micOn, setMicrophoneEnabled: jest.fn(async () => undefined) },
    remoteParticipants: participants,
    on: jest.fn((_event: string, handler: Handler) => handlers.add(handler)),
    off: jest.fn((_event: string, handler: Handler) => handlers.delete(handler)),
  };
  const join = () => {
    participants.set("p2", late);
    for (const handler of handlers) handler(late);
  };
  return { room, peer, late, handlers, join, asRoom: room as unknown as Room };
}

// The session's other events (CallKit's mute) leave the hold alone.
const hold = (held: boolean) =>
  act(() => {
    mockListener({ type: "muted", callId: "c-1", muted: true });
    mockListener({ type: "held", callId: "", held });
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(nativeCallSession.isHeld).mockReturnValue(false);
});

describe("useCellularHold", () => {
  it("holds the call while the phone's own call has the line, then gives it back", async () => {
    const f = fakeRoom();
    const { result } = await renderHook(() => useCellularHold(f.asRoom, true));
    expect(result.current).toBe(false);
    expect(f.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();

    await hold(true);
    expect(result.current).toBe(true);
    expect(f.room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(0);
    // Someone joining a group call meanwhile is silent too.
    f.join();
    expect(f.late.setVolume).toHaveBeenLastCalledWith(0);

    await hold(false);
    expect(result.current).toBe(false);
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(1);
    expect(f.late.setVolume).toHaveBeenLastCalledWith(1);
    expect(f.room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(f.handlers.size).toBe(0);
  });

  it("leaves a microphone the person had turned off off after the hold", async () => {
    const f = fakeRoom(false);
    await renderHook(() => useCellularHold(f.asRoom, true));
    await hold(true);
    await hold(false);
    expect(f.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(1);
  });

  it("holds from the start when the phone's call already had the line, and waits for the room to connect", async () => {
    jest.mocked(nativeCallSession.isHeld).mockReturnValue(true);
    const f = fakeRoom();
    const view = await renderHook(({ connected }: { connected: boolean }) => useCellularHold(f.asRoom, connected), { initialProps: { connected: false } });
    expect(view.result.current).toBe(true);
    expect(f.peer.setVolume).not.toHaveBeenCalled();
    await view.rerender({ connected: true });
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(0);
    expect(f.room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it("does not turn the microphone back on in a room already gone, and stops listening when the call screen goes", async () => {
    const f = fakeRoom();
    const view = await renderHook(() => useCellularHold(f.asRoom, true));
    await hold(true);
    f.room.state = "disconnected";
    await view.unmount();
    expect(f.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("holds the call all the same when LiveKit will not change the microphone", async () => {
    const f = fakeRoom();
    f.room.localParticipant.setMicrophoneEnabled.mockRejectedValue(new Error("busy"));
    await renderHook(() => useCellularHold(f.asRoom, true));
    await hold(true);
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(0);
    await hold(false);
    expect(f.peer.setVolume).toHaveBeenLastCalledWith(1);
  });
});
