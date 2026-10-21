import { describe, expect, it } from "vitest";
import { nextVoiceRate, playedBars, seekBy, seekToTap, VOICE_SEEK_STEP_S } from "./voice-player";

describe("voice player", () => {
  it("cycles 1×, 1.5×, 2× and back, starting over from an unknown rate", () => {
    expect(nextVoiceRate(1)).toBe(1.5);
    expect(nextVoiceRate(1.5)).toBe(2);
    expect(nextVoiceRate(2)).toBe(1);
    expect(nextVoiceRate(3)).toBe(1);
  });

  it("seeks by a step within the clip", () => {
    expect(seekBy(10, VOICE_SEEK_STEP_S, 42)).toBe(15);
    expect(seekBy(40, VOICE_SEEK_STEP_S, 42)).toBe(42);
    expect(seekBy(2, -VOICE_SEEK_STEP_S, 42)).toBe(0);
    expect(seekBy(2, VOICE_SEEK_STEP_S, 0)).toBe(7);
  });

  it("seeks to where a tap landed on the bars", () => {
    expect(seekToTap(50, 200, 40)).toBe(10);
    expect(seekToTap(-10, 200, 40)).toBe(0);
    expect(seekToTap(300, 200, 40)).toBe(40);
    expect(seekToTap(50, 0, 40)).toBe(0);
    expect(seekToTap(50, 200, 0)).toBe(0);
  });

  it("fills the bars the played part covers", () => {
    expect(playedBars(10, 40, 30)).toBe(8);
    expect(playedBars(50, 40, 30)).toBe(30);
    expect(playedBars(10, 0, 30)).toBe(0);
  });
});
