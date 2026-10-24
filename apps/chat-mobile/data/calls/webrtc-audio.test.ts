// CallKit's audio handed to WebRTC, with the WebRTC package loaded only when an audio event comes (webrtc-audio.ts).
// The module loads it with require, which vi.mock does not see: the package's entry in Node's module cache is the
// stand-in, so nothing of React Native or WebRTC runs here.
import { createRequire } from "node:module";
import { afterAll, describe, expect, it, vi } from "vitest";

const nodeRequire = createRequire(import.meta.url);
const entry = nodeRequire.resolve("@livekit/react-native-webrtc");
const rtc = { audioSessionDidActivate: vi.fn(), audioSessionDidDeactivate: vi.fn() };
let loads = 0;
const stand = { id: entry, filename: entry, loaded: true, children: [], paths: [] } as unknown as NodeJS.Module;
Object.defineProperty(stand, "exports", {
  get: () => {
    loads += 1;
    return { RTCAudioSession: rtc };
  },
});
nodeRequire.cache[entry] = stand;

afterAll(() => {
  delete nodeRequire.cache[entry];
});

const { webrtcAudio } = await import("./webrtc-audio");

describe("webrtcAudio", () => {
  it("loads no WebRTC until CallKit's audio event", () => {
    expect(loads).toBe(0);
  });

  it("tells WebRTC when CallKit activates and releases the call's audio session", () => {
    webrtcAudio.activate();
    expect(rtc.audioSessionDidActivate).toHaveBeenCalledTimes(1);
    webrtcAudio.deactivate();
    expect(rtc.audioSessionDidDeactivate).toHaveBeenCalledTimes(1);
    expect(loads).toBeGreaterThan(0);
  });
});
