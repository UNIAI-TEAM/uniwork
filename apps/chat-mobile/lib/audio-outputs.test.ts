import { describe, expect, it } from "vitest";
import { AUDIO_OUTPUT_ICONS, AUDIO_OUTPUT_LABEL_KEYS, audioOutputOptions, automaticOutput, isSpeakerToggle, preferredOutputs, proximityScreenOff } from "./audio-outputs";

describe("audio outputs", () => {
  it("starts a voice call on the earpiece and a video call on the speaker, a headset before either", () => {
    expect(preferredOutputs(false)).toEqual(["bluetooth", "headset", "earpiece", "speaker"]);
    expect(preferredOutputs(true)).toEqual(["bluetooth", "headset", "speaker", "earpiece"]);
  });

  it("knows where LiveKit sent a new call by itself", () => {
    expect(automaticOutput(false, ["speaker", "earpiece"])).toBe("earpiece");
    expect(automaticOutput(true, ["speaker", "earpiece"])).toBe("speaker");
    expect(automaticOutput(true, ["speaker", "earpiece", "bluetooth"])).toBe("bluetooth");
    expect(automaticOutput(false, [])).toBe("earpiece");
    expect(automaticOutput(true, [])).toBe("speaker");
  });

  it("keeps the outputs it knows, in a stable order", () => {
    expect(audioOutputOptions(["speaker", "usb", "bluetooth", "earpiece"])).toEqual(["bluetooth", "earpiece", "speaker"]);
    expect(audioOutputOptions([])).toEqual([]);
  });

  it("toggles when the phone has only its own two, lists when a headset is there", () => {
    expect(isSpeakerToggle(["earpiece", "speaker"])).toBe(true);
    expect(isSpeakerToggle(["speaker"])).toBe(true);
    expect(isSpeakerToggle(["bluetooth", "earpiece", "speaker"])).toBe(false);
  });

  it("turns the screen off at the ear only for a connected voice call on the earpiece, its screen in front", () => {
    const atTheEar = { connected: true, video: false, output: "earpiece", onScreen: true } as const;
    expect(proximityScreenOff(atTheEar)).toBe(true);
    expect(proximityScreenOff({ ...atTheEar, connected: false })).toBe(false);
    expect(proximityScreenOff({ ...atTheEar, video: true })).toBe(false);
    for (const output of ["speaker", "bluetooth", "headset"] as const) expect(proximityScreenOff({ ...atTheEar, output })).toBe(false);
    // Shrunk to a pill or the app in the background: the person reads a chat or another app, a hand must not blank it.
    expect(proximityScreenOff({ ...atTheEar, onScreen: false })).toBe(false);
  });

  it("names and draws every output", () => {
    expect(Object.keys(AUDIO_OUTPUT_LABEL_KEYS).sort()).toEqual(Object.keys(AUDIO_OUTPUT_ICONS).sort());
  });
});
