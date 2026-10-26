import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCachedVoiceRecordingPlayback,
  rememberVoiceRecordingPlayback,
  releaseVoiceRecordingPlayback,
  voiceRecordingPlaybackCacheKey,
} from "./voice-recording-playback-cache";

describe("voice-recording-playback-cache", () => {
  const revoke = vi.fn<(url: string) => void>();

  afterEach(() => {
    for (const key of ["ws:room:a", "ws:room:b", "ws:room:remote"]) {
      releaseVoiceRecordingPlayback(key);
    }
    revoke.mockReset();
  });

  it("keeps at most one blob in memory", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:a",
      revokeObjectURL: revoke,
    });

    const keyA = voiceRecordingPlaybackCacheKey("ws", "room", "a");
    const keyB = voiceRecordingPlaybackCacheKey("ws", "room", "b");
    rememberVoiceRecordingPlayback(keyA, { kind: "blob", url: "blob:a" });
    rememberVoiceRecordingPlayback(keyB, { kind: "blob", url: "blob:b" });

    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(getCachedVoiceRecordingPlayback(keyA)).toBeNull();
    expect(getCachedVoiceRecordingPlayback(keyB)?.url).toBe("blob:b");

    const keyRemote = voiceRecordingPlaybackCacheKey("ws", "room", "remote");
    rememberVoiceRecordingPlayback(keyRemote, {
      kind: "remote",
      url: "https://cdn/x.mp4",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    rememberVoiceRecordingPlayback(keyB, { kind: "blob", url: "blob:b2" });
    expect(getCachedVoiceRecordingPlayback(keyRemote)?.kind).toBe("remote");

    vi.unstubAllGlobals();
  });
});
