import { describe, expect, it } from "vitest";
import { speakerTestWav } from "./meeting-speaker-test";

describe("speakerTestWav", () => {
  it("builds a playable mono 16-bit WAV with a non-silent body", () => {
    const wav = speakerTestWav();
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(wav.length - 44);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(0x7fff * 0.1);
    expect(peak).toBeLessThanOrEqual(0x7fff);
  });
});
