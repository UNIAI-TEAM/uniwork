import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cycleChatVoicePlaybackRate,
  seekChatVoicePlayback,
  stopChatVoicePlayback,
  toggleChatVoicePlayback,
  useChatVoicePlaybackStore,
} from "./voice-playback-store";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  playbackRate = 1;
  defaultPlaybackRate = 1;
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
});

afterEach(() => {
  stopChatVoicePlayback();
  vi.unstubAllGlobals();
});

// The signed storage URL a voice message carries (UNI-1633).
const signed = (id: string) => () => Promise.resolve(`https://storage.test/chat/voice/${id}?sig=1`);

describe("voice playback store", () => {
  it("plays one message at a time: starting another stops the first", async () => {
    await toggleChatVoicePlayback("m1", signed("m1"));
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m1", status: "playing" });
    expect(player()?.src).toBe("https://storage.test/chat/voice/m1?sig=1");

    await toggleChatVoicePlayback("m2", signed("m2"));
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m2", status: "playing" });
    // One shared element, so nothing of m1 keeps sounding; it streams m2 now.
    expect(FakeAudio.instances).toHaveLength(1);
    expect(player()?.src).toBe("https://storage.test/chat/voice/m2?sig=1");
  });

  it("pauses and resumes the same message, and seeks within it", async () => {
    await toggleChatVoicePlayback("m1", signed("m1"));
    await toggleChatVoicePlayback("m1", signed("m1"));
    expect(useChatVoicePlaybackStore.getState().status).toBe("paused");
    seekChatVoicePlayback("m1", 1500);
    expect(player()?.currentTime).toBe(1.5);
    expect(useChatVoicePlaybackStore.getState().positionMs).toBe(1500);
    seekChatVoicePlayback("other", 99);
    expect(useChatVoicePlaybackStore.getState().positionMs).toBe(1500);
    await toggleChatVoicePlayback("m1", signed("m1"));
    expect(useChatVoicePlaybackStore.getState().status).toBe("playing");
  });

  it("reports a clip that will not load", async () => {
    await toggleChatVoicePlayback("m1", () => Promise.reject(new Error("404")));
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: "m1", status: "error" });
  });

  it("steps the speed 1× → 1,5× → 2× → 1× and keeps it for the next message", async () => {
    await toggleChatVoicePlayback("m1", signed("m1"));
    cycleChatVoicePlaybackRate();
    expect(useChatVoicePlaybackStore.getState().rate).toBe(1.5);
    expect(player()?.playbackRate).toBe(1.5);
    cycleChatVoicePlaybackRate();
    // A new source and a stop leave the chosen speed in place.
    await toggleChatVoicePlayback("m2", signed("m2"));
    stopChatVoicePlayback();
    await toggleChatVoicePlayback("m3", signed("m3"));
    expect(player()?.playbackRate).toBe(2);
    cycleChatVoicePlaybackRate();
    expect(useChatVoicePlaybackStore.getState().rate).toBe(1);
  });

  it("stops everything when the room is left", async () => {
    await toggleChatVoicePlayback("m1", signed("m1"));
    stopChatVoicePlayback();
    expect(useChatVoicePlaybackStore.getState()).toMatchObject({ activeId: null, status: "idle" });
    expect(player()?.paused).toBe(true);
  });
});
