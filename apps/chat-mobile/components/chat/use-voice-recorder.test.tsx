// Recording a voice message (use-voice-recorder.ts) on expo-audio's Jest mock (test/jest-setup.ts): the microphone
// asked first, the audio session switched to recording and back, a clip sent once with its length, a cancel or an
// empty clip sending nothing, the two-minute cap sending on its own, and leaving mid-clip giving the audio back.
import { act, renderHook } from "@testing-library/react-native";
import * as audio from "expo-audio";
import { permissionGate } from "@/components/ui/permission-gate";
import { VOICE_MAX_MS, useVoiceRecorder, type VoiceClip } from "./use-voice-recorder";

interface MockRecorder {
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  stop: jest.Mock;
  getStatus: jest.Mock;
  uri: string | null;
}

const recorder = jest.mocked(audio.useAudioRecorder)(audio.RecordingPresets.HIGH_QUALITY) as unknown as MockRecorder;
const audioMode = jest.mocked(audio.setAudioModeAsync);
const recorderState = jest.mocked(audio.useAudioRecorderState);

const recording = { allowsRecording: true, playsInSilentMode: true };
const playback = { allowsRecording: false, playsInSilentMode: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
  recorder.uri = "file:///clip.m4a";
  recorder.getStatus.mockReturnValue({ durationMillis: 3_200 });
  recorder.prepareToRecordAsync.mockResolvedValue(undefined);
  recorderState.mockReturnValue({ isRecording: false, durationMillis: 0 } as never);
});
afterEach(() => jest.restoreAllMocks());

function setup() {
  const clips: VoiceClip[] = [];
  const hook = renderHook(() => useVoiceRecorder((clip) => clips.push(clip)));
  return { clips, hook };
}

describe("useVoiceRecorder", () => {
  it("asks for the microphone, records, and sends the clip once with its length", async () => {
    const { clips, hook } = setup();
    const { result } = await hook;
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.start();
    });
    expect(started).toBe(true);
    expect(permissionGate.ensure).toHaveBeenCalledWith("microphone", "voice");
    expect(audioMode).toHaveBeenCalledWith(recording);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(true);

    await act(() => result.current.send());
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(audioMode).toHaveBeenLastCalledWith(playback);
    expect(clips).toEqual([{ uri: "file:///clip.m4a", durationMs: 3_200 }]);
    expect(result.current.active).toBe(false);
    // A second tap on send has nothing left to send.
    await act(() => result.current.send());
    expect(clips).toHaveLength(1);
  });

  it("records nothing when the person keeps the microphone off", async () => {
    jest.mocked(permissionGate.ensure).mockResolvedValueOnce(false);
    const { result } = await setup().hook;
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.start();
    });
    expect(started).toBe(false);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it("gives the audio back to playback and rejects when the recorder will not start", async () => {
    recorder.prepareToRecordAsync.mockRejectedValueOnce(new Error("busy"));
    const { result } = await setup().hook;
    await act(async () => {
      await expect(result.current.start()).rejects.toThrow("busy");
    });
    expect(audioMode).toHaveBeenLastCalledWith(playback);
    expect(result.current.active).toBe(false);
  });

  it("sends nothing on cancel, for an empty clip, or without a file", async () => {
    const { clips, hook } = setup();
    const { result } = await hook;
    await act(async () => void (await result.current.start()));
    await act(() => result.current.cancel());
    expect(recorder.stop).toHaveBeenCalledTimes(1);

    recorder.getStatus.mockReturnValue({ durationMillis: 0 });
    await act(async () => void (await result.current.start()));
    await act(() => result.current.send());

    recorder.getStatus.mockReturnValue({ durationMillis: 900 });
    recorder.uri = null;
    await act(async () => void (await result.current.start()));
    await act(() => result.current.send());
    expect(clips).toEqual([]);
  });

  it("sends the clip on its own at the two-minute cap", async () => {
    const { clips, hook } = setup();
    const { result, rerender } = await hook;
    await act(async () => void (await result.current.start()));
    recorderState.mockReturnValue({ isRecording: true, durationMillis: VOICE_MAX_MS } as never);
    recorder.getStatus.mockReturnValue({ durationMillis: VOICE_MAX_MS });
    await act(async () => rerender({}));
    expect(result.current.elapsedMs).toBe(VOICE_MAX_MS);
    expect(clips).toEqual([{ uri: "file:///clip.m4a", durationMs: VOICE_MAX_MS }]);
  });

  it("drops a clip left mid-recording and gives the audio back, even when that fails", async () => {
    const { clips, hook } = setup();
    const { result, unmount } = await hook;
    await act(async () => void (await result.current.start()));
    audioMode.mockRejectedValueOnce(new Error("session gone"));
    await act(async () => unmount());
    expect(audioMode).toHaveBeenLastCalledWith(playback);
    expect(clips).toEqual([]);
  });

  it("leaves the audio alone when the screen closes with nothing recording", async () => {
    const { unmount } = await setup().hook;
    await act(async () => unmount());
    expect(audioMode).not.toHaveBeenCalled();
  });
});
