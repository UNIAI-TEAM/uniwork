import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetingRecorder } from "./recorder";
import { memoryRecordingStore } from "./store";
import { useMeetingRecorder } from "./use-meeting-recorder";

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  enabled = true;
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
  /** The OS took the microphone away: a locked phone, an unplugged headset. */
  end(): void {
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeRecorder {
  static all: FakeRecorder[] = [];
  static isTypeSupported = (type: string): boolean => type === "audio/mp4";
  state: RecordingState = "inactive";
  timeslice: number | undefined;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
    FakeRecorder.all.push(this);
  }
  get mimeType(): string {
    return this.options.mimeType ?? "";
  }
  start(timeslice?: number): void {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  /** One timeslice's worth of audio. */
  tick(data: string): void {
    this.ondataavailable?.({ data: new Blob([data]) } as BlobEvent);
  }
  /** Like the browser: the last bit of audio, then the stop event. */
  stop(): void {
    this.tick("!");
    this.state = "inactive";
    this.onstop?.();
  }
}

type Language = "vi" | "en";

function setup(over: { baseStartedAt?: number; language?: () => Language; refuse?: unknown } = {}) {
  let clock = 1_000_000;
  let ids = 0;
  const tracks: FakeTrack[] = [];
  const getUserMedia = vi.fn((_constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (over.refuse) return Promise.reject(over.refuse);
    const track = new FakeTrack();
    tracks.push(track);
    return Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream);
  });
  const store = memoryRecordingStore();
  const recorder = createMeetingRecorder({
    store,
    userId: "u1",
    meetingId: "m1",
    // A getter, like the hook's: the recorder must read it when recording starts.
    get language() {
      return over.language?.() ?? "vi";
    },
    getUserMedia,
    MediaRecorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
    now: () => clock,
    newId: () => `part-${++ids}`,
    baseStartedAt: over.baseStartedAt,
  });
  return {
    recorder,
    store,
    getUserMedia,
    tracks,
    parts: () => store.listParts("u1", "m1"),
    media: (): FakeRecorder => FakeRecorder.all[FakeRecorder.all.length - 1]!,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

async function text(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

beforeEach(() => {
  FakeRecorder.all = [];
});

describe("createMeetingRecorder", () => {
  it("every chunk is saved as soon as it arrives", async () => {
    const t = setup();
    const startedAt = t.now();
    await t.recorder.start();
    expect(t.recorder.state).toBe("recording");
    expect(t.media().options).toEqual({ mimeType: "audio/mp4", audioBitsPerSecond: 48_000 });
    expect(t.media().timeslice).toBe(5_000);

    t.advance(5_000);
    t.media().tick("aaaa");
    t.advance(5_000);
    t.media().tick("bb");
    await vi.waitFor(async () => expect((await t.parts())[0]).toMatchObject({ bytes: 6, lastChunkAt: startedAt + 10_000 }));
    expect((await t.parts())[0]).toMatchObject({
      id: "part-1", userId: "u1", meetingId: "m1", startedAt, endedAt: null, mimeType: "audio/mp4",
      language: "vi", offsetSeconds: 0,
    });

    t.advance(1_000);
    await t.recorder.stop();
    expect(t.recorder.state).toBe("stopped");
    expect(t.tracks[0]?.stopped).toBe(true);
    const [part] = await t.parts();
    expect(part?.endedAt).toBe(startedAt + 11_000);
    // The tail the browser hands over on stop lands before the part closes.
    expect(await text(await t.store.readPart("part-1"))).toBe("aaaabb!");
  });

  it("pause silences the track and stops the clock", async () => {
    const t = setup();
    const seen = vi.fn();
    t.recorder.subscribe(seen);
    await t.recorder.start();
    t.advance(3_000);
    expect(t.recorder.activeMs()).toBe(3_000);

    t.recorder.pause();
    expect(t.recorder.state).toBe("paused");
    expect(t.tracks[0]?.enabled).toBe(false);
    // The file keeps running: the pause is silence in it, so later offsets stay wall-clock.
    expect(t.media().state).toBe("recording");
    t.advance(10_000);
    expect(t.recorder.activeMs()).toBe(3_000);

    t.recorder.resume();
    expect(t.recorder.state).toBe("recording");
    expect(t.tracks[0]?.enabled).toBe(true);
    t.advance(2_000);
    expect(t.recorder.activeMs()).toBe(5_000);
    expect(seen).toHaveBeenCalled();
  });

  it("a track that ends closes the part and interrupts", async () => {
    const t = setup();
    const startedAt = t.now();
    await t.recorder.start();
    t.advance(60_000);
    t.tracks[0]?.end();
    expect(t.recorder.state).toBe("interrupted");
    await vi.waitFor(async () => expect((await t.parts())[0]?.endedAt).toBe(startedAt + 60_000));

    t.advance(30_000);
    await t.recorder.resumeAfterInterrupt();
    expect(t.recorder.state).toBe("recording");
    expect(t.getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    const parts = await t.parts();
    expect(parts.map((p) => p.offsetSeconds)).toEqual([0, 90]);
    expect(parts[1]?.endedAt).toBeNull();
    // Only recording time counts: the interruption is not on the clock.
    t.advance(10_000);
    expect(t.recorder.activeMs()).toBe(70_000);
  });

  it("switching device starts a new part", async () => {
    const t = setup();
    await t.recorder.start("d1");
    expect(t.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: "d1" } } });
    t.advance(10_000);
    t.recorder.pause();
    await t.recorder.switchDevice("d2");
    expect(t.getUserMedia).toHaveBeenCalledTimes(2);
    expect(t.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: "d2" } } });
    const parts = await t.parts();
    expect(parts.map((p) => [p.offsetSeconds, p.endedAt])).toEqual([[0, t.now()], [10, null]]);
    expect(t.tracks[0]?.stopped).toBe(true);
    // A paused recording stays paused on the new microphone.
    expect(t.recorder.state).toBe("paused");
    expect(t.tracks[1]?.enabled).toBe(false);
  });

  it("refused microphone fails", async () => {
    const refusal = new DOMException("no", "NotAllowedError");
    const t = setup({ refuse: refusal });
    await t.recorder.start();
    expect(t.recorder.state).toBe("failed");
    expect(t.recorder.error).toBe(refusal);
    expect(await t.parts()).toEqual([]);
  });

  it("continuing an unsent recording keeps the offsets", async () => {
    const t = setup({ baseStartedAt: 1_000_000 - 600_000 });
    await t.recorder.start();
    expect((await t.parts())[0]?.offsetSeconds).toBe(600);
  });

  it("reads the language when recording starts and keeps it for the session", async () => {
    const options = { language: "vi" as Language };
    const t = setup({ language: () => options.language });
    options.language = "en";
    await t.recorder.start();
    options.language = "vi";
    t.tracks[0]?.end();
    await t.recorder.resumeAfterInterrupt();
    expect((await t.parts()).map((p) => p.language)).toEqual(["en", "en"]);
  });
});

describe("useMeetingRecorder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds the screen awake and guards the tab while a recording is open", async () => {
    const sentinels: (EventTarget & { released: boolean; release: () => Promise<void> })[] = [];
    const request = vi.fn(() => {
      const sentinel = Object.assign(new EventTarget(), {
        released: false,
        release: () => {
          sentinel.released = true;
          sentinel.dispatchEvent(new Event("release"));
          return Promise.resolve();
        },
      });
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });
    const track = new FakeTrack();
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {
      wakeLock: { request },
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) },
    });
    const unloadBlocked = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const store = memoryRecordingStore();
    const { result } = renderHook(() => useMeetingRecorder({ userId: "u1", meetingId: "m1", language: "en", store }));
    expect(result.current.state).toBe("idle");
    expect(unloadBlocked()).toBe(false);

    await act(() => result.current.recorder.start());
    expect(result.current.state).toBe("recording");
    expect(result.current.wakeLockHeld).toBe(true);
    expect(request).toHaveBeenCalledWith("screen");
    expect(unloadBlocked()).toBe(true);

    // Hidden, the browser drops the lock; visible again, the hook takes it back.
    await act(() => sentinels[0]!.release());
    expect(result.current.wakeLockHeld).toBe(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.wakeLockHeld).toBe(true);

    await act(() => result.current.recorder.stop());
    expect(result.current.state).toBe("stopped");
    expect(result.current.wakeLockHeld).toBe(false);
    expect(sentinels[1]?.released).toBe(true);
    expect(unloadBlocked()).toBe(false);
  });
});
