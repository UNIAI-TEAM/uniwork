import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  seekChatVoicePlayback,
  stopChatVoicePlayback,
  toggleChatVoicePlayback,
  useChatVoicePlaybackStore,
} from "./voice-playback-store";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  preload = "";
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    this.paused = false;
    this.onplay?.();
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.onpause?.();
  }
  getAttribute(name: string) {
    return name === "src" ? this.src || null : null;
  }
  removeAttribute() {
    this.src = "";
  }
}

// The store keeps one element for the page's lifetime, so instances are not
// reset between tests: the last one is the shared player.
const player = () => FakeAudio.instances[FakeAudio.instances.length - 1];

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:voice"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  stopChatVoicePlayback();
  vi.unstubAllGlobals();
});

const blob = () => Promise.resolve(new Blob(["a"], { type: "audio/webm" }));

describe("voice playback store", () => {
  it("plays one message at a time: starting another stops the first", async () => {
    await toggleChatVoicePlayback("m1", blob);
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m1", status: "playing" });

    await toggleChatVoicePlayback("m2", blob);
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m2", status: "playing" });
    // One shared element, so nothing of m1 keeps sounding.
    expect(FakeAudio.instances).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("pauses and resumes the same message, and seeks within it", async () => {
    await toggleChatVoicePlayback("m1", blob);
    await toggleChatVoicePlayback("m1", blob);
    expect(useChatVoicePlaybackStore.getState().status).toBe("paused");
    seekChatVoicePlayback("m1", 1500);
    expect(player()?.currentTime).toBe(1.5);
    expect(useChatVoicePlaybackStore.getState().positionMs).toBe(1500);
    seekChatVoicePlayback("other", 99);
    expect(useChatVoicePlaybackStore.getState().positionMs).toBe(1500);
    await toggleChatVoicePlayback("m1", blob);
    expect(useChatVoicePlaybackStore.getState().status).toBe("playing");
  });

  it("reports a clip that will not load", async () => {
    await toggleChatVoicePlayback("m1", () => Promise.reject(new Error("404")));
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m1", status: "error" });
  });

  it("stops everything when the room is left", async () => {
    await toggleChatVoicePlayback("m1", blob);
    stopChatVoicePlayback();
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: null, status: "idle" });
    expect(player()?.paused).toBe(true);
  });
});
