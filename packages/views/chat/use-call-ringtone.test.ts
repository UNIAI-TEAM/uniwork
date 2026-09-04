import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallRingtone } from "./use-call-ringtone";

class FakeOscillator {
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};
  createOscillator = vi.fn(() => new FakeOscillator());
  createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() }));
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

describe("useCallRingtone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContext(this: FakeAudioContext) {
        return new FakeAudioContext();
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schedules incoming tones while kind is set", () => {
    renderHook(({ kind }) => useCallRingtone(kind), {
      initialProps: { kind: "incoming" as const },
    });

    vi.advanceTimersByTime(100);
    expect(AudioContext).toHaveBeenCalled();
  });

  it("clears audio when kind becomes null", () => {
    const { rerender } = renderHook(({ kind }) => useCallRingtone(kind), {
      initialProps: { kind: "outgoing" as const },
    });

    rerender({ kind: null });
    vi.advanceTimersByTime(2_500);
    expect(AudioContext).toHaveBeenCalled();
  });
});
