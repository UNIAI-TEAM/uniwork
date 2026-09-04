import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVoiceCapture } from "./voice-call-media";

describe("prepareVoiceCapture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when getUserMedia is unavailable", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    await expect(prepareVoiceCapture()).resolves.toBe(false);
  });

  it("stops tracks and returns true when mic access succeeds", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVoiceCapture()).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("returns false when mic access is denied", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVoiceCapture()).resolves.toBe(false);
  });
});
