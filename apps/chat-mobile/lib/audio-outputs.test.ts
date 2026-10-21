import { describe, expect, it } from "vitest";
import { AUDIO_OUTPUT_ICONS, AUDIO_OUTPUT_LABEL_KEYS, audioOutputOptions, automaticOutput, isSpeakerToggle, preferredOutputs } from "./audio-outputs";

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

  it("names and draws every output", () => {
    expect(Object.keys(AUDIO_OUTPUT_LABEL_KEYS).sort()).toEqual(Object.keys(AUDIO_OUTPUT_ICONS).sort());
  });
});
