// The media half of a call (call-room.tsx) on stand-ins for LiveKit (WebRTC has no Jest build): the phone's
// audio routed for the call and given back after it, connecting → the running clock, the other side's picture
// filling the screen and ours in a corner, mic / camera / hang-up, the recording notice, minimizing, and the room
// letting go of us — moved to another device of ours leaves the call there, anything else ends it here.
import { AudioSession } from "@livekit/react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { nativeCallSync } from "@/data/calls/call-wiring";
import { callEngine } from "@/data/calls/call-store";
import { permissionGate } from "@/components/ui/permission-gate";
import { render, viText } from "@/test/render";
import { CallRoom } from "./call-room";

interface MockTrackRef {
  participant: { isLocal: boolean };
  publication: object;
}
const mockLive = {
  onConnected: undefined as (() => void) | undefined,
  tracks: [] as MockTrackRef[],
  local: {
    isMicrophoneEnabled: true,
    isCameraEnabled: false,
    localParticipant: { setCameraEnabled: jest.fn(async () => undefined), setMicrophoneEnabled: jest.fn(async () => undefined) },
  },
};

jest.mock("@livekit/react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    registerGlobals: jest.fn(),
    AndroidAudioTypePresets: { communication: { audioMode: "inCommunication" } },
    AudioSession: {
      configureAudio: jest.fn(async () => undefined),
      startAudioSession: jest.fn(async () => undefined),
      stopAudioSession: jest.fn(async () => undefined),
    },
    LiveKitRoom: ({ children, onConnected }: { children: React.ReactNode; onConnected: () => void }) => {
      mockLive.onConnected = onConnected;
      return children;
    },
    VideoTrack: ({ mirror }: { mirror?: boolean }) => <View testID={mirror ? "video-local" : "video-remote"} />,
    isTrackReference: (ref: { publication?: object } | undefined) => Boolean(ref?.publication),
    useLocalParticipant: () => mockLive.local,
    useTracks: () => mockLive.tracks,
  };
});

type Handler = (reason?: number) => void;
const mockRooms: { handlers: Map<string, Set<Handler>>; disconnect: jest.Mock }[] = [];
jest.mock("livekit-client", () => ({
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2 },
  RoomEvent: { Disconnected: "disconnected" },
  Track: { Source: { Camera: "camera" } },
  Room: class {
    handlers = new Map<string, Set<Handler>>();
    disconnect = jest.fn(async () => undefined);
    constructor() {
      mockRooms.push(this);
    }
    on(event: string, handler: Handler) {
      const set = this.handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      this.handlers.set(event, set);
      return this;
    }
    off(event: string, handler: Handler) {
      this.handlers.get(event)?.delete(handler);
      return this;
    }
  },
}));
jest.mock("@/data/calls/call-wiring", () => ({ nativeCallSync: { refresh: jest.fn() } }));
// The hold itself is use-cellular-hold.test.tsx; here only what the screen says about it.
const mockHold = { held: false, args: [] as unknown[] };
jest.mock("./use-cellular-hold", () => ({
  useCellularHold: (...args: unknown[]) => {
    mockHold.args = args;
    return mockHold.held;
  },
}));
// The output picker reads the phone's routes; its own test is audio-output-button.test.tsx. The stand-in says
// whether the room told it its screen is in front (the proximity wake lock hangs on that).
jest.mock("./audio-output-button", () => ({
  AudioOutputButton: ({ onScreen }: { onScreen: boolean }) => {
    const { Text: T } = jest.requireActual<typeof import("react-native")>("react-native");
    return <T testID="audio-output">{onScreen ? "on-screen" : "shrunk"}</T>;
  },
}));

const session = jest.mocked(AudioSession);
const remoteVideo: MockTrackRef = { participant: { isLocal: false }, publication: {} };
const localVideo: MockTrackRef = { participant: { isLocal: true }, publication: {} };

const room = () => {
  const latest = mockRooms.at(-1);
  if (!latest) throw new Error("no Room was made");
  return latest;
};
const disconnectFromServer = (reason?: number) => {
  for (const handler of room().handlers.get("disconnected") ?? []) handler(reason);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms.length = 0;
  mockLive.tracks = [];
  mockLive.local.isMicrophoneEnabled = true;
  mockLive.local.isCameraEnabled = false;
  mockHold.held = false;
  jest.spyOn(callEngine, "markConnected").mockImplementation(() => undefined);
  jest.spyOn(callEngine, "hangUp").mockResolvedValue(undefined as never);
  jest.spyOn(callEngine, "finalizeCallOnDisconnect").mockImplementation(() => undefined as never);
  jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe("CallRoom", () => {
  it("routes a voice call to the earpiece, then shows the clock once LiveKit connects", async () => {
    jest.useFakeTimers();
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    await act(async () => undefined);
    expect(session.configureAudio).toHaveBeenCalledWith(expect.objectContaining({ ios: { defaultOutput: "earpiece" } }));
    expect(session.startAudioSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(viText("chat.voice_call_connecting"))).toBeOnTheScreen();

    await act(async () => mockLive.onConnected?.());
    expect(callEngine.markConnected).toHaveBeenCalledTimes(1);
    expect(nativeCallSync.refresh).toHaveBeenCalledWith(callEngine.store.getState().call);
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(screen.getByText(viText("chat.mobile.call_voice_duration", { duration: "0:02" }))).toBeOnTheScreen();
  });

  it("routes a video call to the speaker and starts the session even when routing fails", async () => {
    session.configureAudio.mockRejectedValueOnce(new Error("no route"));
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera recording={false} />);
    await settle();
    expect(session.configureAudio).toHaveBeenCalledWith(expect.objectContaining({ ios: { defaultOutput: "speaker" } }));
    expect(session.startAudioSession).toHaveBeenCalledTimes(1);
  });

  it("fills the screen with the other side's picture, our camera in a corner, the name and clock over it", async () => {
    mockLive.tracks = [remoteVideo, localVideo];
    mockLive.local.isCameraEnabled = true;
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera recording={false} />);
    await act(async () => mockLive.onConnected?.());
    expect(screen.getByTestId("video-remote")).toBeOnTheScreen();
    expect(screen.getByTestId("video-local")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.you"))).toBeOnTheScreen();
    expect(screen.getByText("Bình")).toBeOnTheScreen();
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  });

  it("hides our corner while our camera is off, and shows connecting over the picture until connected", async () => {
    mockLive.tracks = [remoteVideo, localVideo, { participant: { isLocal: false } } as MockTrackRef];
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    expect(screen.queryByTestId("video-local")).toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent(viText("chat.voice_call_connecting"));
  });

  it("turns the camera and the microphone on and off, and hangs up", async () => {
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    await fireEvent.press(screen.getByTestId("call-video"));
    await settle();
    expect(permissionGate.ensure).toHaveBeenCalledWith("camera", "video");
    expect(mockLive.local.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: viText("chat.voice_call_mic") })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("call-mute"));
    expect(mockLive.local.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    await fireEvent.press(screen.getByTestId("call-hangup"));
    expect(callEngine.hangUp).toHaveBeenCalledTimes(1);
  });

  it("names the microphone off and turns it back on", async () => {
    mockLive.local.isMicrophoneEnabled = false;
    mockLive.local.isCameraEnabled = true;
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera recording={false} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_mic_off") }));
    expect(mockLive.local.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await fireEvent.press(screen.getByTestId("call-video"));
    await settle();
    expect(mockLive.local.localParticipant.setCameraEnabled).toHaveBeenCalledWith(false);
  });

  it("says the call is being recorded, and minimizes only when it may", async () => {
    const minimize = jest.fn();
    const view = await render(<CallRoom url="wss://lk" token="t" peerName="Nhóm" withCamera={false} recording onMinimize={minimize} roomFace seed="g1" />);
    expect(screen.getByText(viText("chat.mobile.call_recording"))).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.mobile.call_summary_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.call_minimize") }));
    expect(minimize).toHaveBeenCalledTimes(1);
    await view.rerender(<CallRoom url="wss://lk" token="t" peerName="Nhóm" withCamera={false} recording={false} />);
    expect(screen.queryByTestId("call-minimize")).toBeNull();
    expect(screen.queryByText(viText("chat.mobile.call_recording"))).toBeNull();
  });

  it("says the call is on hold while the phone's own call has the line", async () => {
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    expect(screen.queryByText(viText("mobile.call_audio.held"))).toBeNull();
    expect(mockHold.args).toEqual([room(), false]);
    mockHold.held = true;
    await act(async () => mockLive.onConnected?.());
    expect(mockHold.args).toEqual([room(), true]);
    expect(screen.getByText(viText("mobile.call_audio.held"))).toBeOnTheScreen();
  });

  it("tells the audio button its screen is no longer in front while the call is shrunk to a pill", async () => {
    const view = await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    expect(screen.getByTestId("audio-output")).toHaveTextContent("on-screen");
    await view.rerender(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} minimized />);
    expect(screen.getByTestId("audio-output")).toHaveTextContent("shrunk");
  });

  it("leaves a call moved to another of our devices there, and ends it here otherwise", async () => {
    await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    disconnectFromServer(2);
    expect(callEngine.finalizeCallOnDisconnect).toHaveBeenLastCalledWith({ movedElsewhere: true });
    disconnectFromServer(1);
    expect(callEngine.finalizeCallOnDisconnect).toHaveBeenLastCalledWith({ movedElsewhere: false });
  });

  it("disconnects the room and gives the audio back when the call screen goes", async () => {
    const view = await render(<CallRoom url="wss://lk" token="t" peerName="Bình" withCamera={false} recording={false} />);
    await view.unmount();
    expect(room().disconnect).toHaveBeenCalledTimes(1);
    expect(room().handlers.get("disconnected")?.size).toBe(0);
    expect(session.stopAudioSession).toHaveBeenCalledTimes(1);
  });
});
