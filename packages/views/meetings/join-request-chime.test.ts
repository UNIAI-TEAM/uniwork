import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playJoinRequestChime } from "./join-request-chime";

type ResumeMode = "running" | "reject" | "hang";

const contexts: FakeContext[] = [];
let resumeMode: ResumeMode = "running";

class FakeContext {
  state = "suspended";
  currentTime = 0;
  destination = {};
  oscillators = 0;
  close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  constructor() {
    contexts.push(this);
  }
  resume() {
    if (resumeMode === "reject") return Promise.reject(new Error("not allowed"));
    if (resumeMode === "hang") return new Promise<void>(() => {});
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    this.oscillators += 1;
    return { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}

function setActivation(hasBeenActive: boolean | undefined) {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: hasBeenActive === undefined ? undefined : { hasBeenActive },
  });
}

describe("playJoinRequestChime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    contexts.length = 0;
    resumeMode = "running";
    vi.stubGlobal("AudioContext", FakeContext);
    setActivation(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setActivation(undefined);
  });

  it("plays two notes and closes its context afterwards", async () => {
    playJoinRequestChime();
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts[0]?.oscillators).toBe(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
  });

  it("opens nothing before the person has interacted with the page", () => {
    setActivation(false);
    playJoinRequestChime();
    expect(contexts).toHaveLength(0);
  });

  it("closes the context when the browser refuses to play", async () => {
    resumeMode = "reject";
    playJoinRequestChime();
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts[0]?.oscillators).toBe(0);
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
  });

  it("gives up on a resume that never settles instead of ringing late", async () => {
    resumeMode = "hang";
    playJoinRequestChime();
    await vi.advanceTimersByTimeAsync(1000);
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
    expect(contexts[0]?.oscillators).toBe(0);
  });
});
