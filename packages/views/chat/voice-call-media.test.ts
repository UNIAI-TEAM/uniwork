import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFailureFromError, prepareVideoCapture, prepareVoiceCapture } from "./voice-call-media";

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("deviceFailureFromError", () => {
  it("sorts getUserMedia rejections like the meeting room does", () => {
    expect(deviceFailureFromError(domError("NotAllowedError"))).toBe("denied");
    expect(deviceFailureFromError(domError("NotReadableError"))).toBe("in_use");
    expect(deviceFailureFromError(domError("NotFoundError"))).toBe("missing");
    expect(deviceFailureFromError(new Error("boom"))).toBe("other");
    expect(deviceFailureFromError(undefined)).toBe("other");
  });
});

describe("prepareVoiceCapture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an unavailable microphone when getUserMedia is missing", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    await expect(prepareVoiceCapture()).resolves.toEqual({
      ok: false,
      device: { kind: "audioinput", failure: "other" },
    });
  });

  it("stops tracks and succeeds when mic access works", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVoiceCapture()).resolves.toEqual({ ok: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("says the microphone is in use rather than 'permission needed'", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError("NotReadableError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVoiceCapture()).resolves.toEqual({
      ok: false,
      device: { kind: "audioinput", failure: "in_use" },
    });
  });
});

describe("prepareVideoCapture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops tracks and succeeds when camera access works", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVideoCapture()).resolves.toEqual({ ok: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("blames the camera when the microphone alone still works", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(domError("NotFoundError"))
      .mockResolvedValueOnce({ getTracks: () => [] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(prepareVideoCapture()).resolves.toEqual({
      ok: false,
      device: { kind: "videoinput", failure: "missing" },
    });
  });
});
