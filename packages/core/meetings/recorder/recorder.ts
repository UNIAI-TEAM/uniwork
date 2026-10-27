import type { RecordingPart, RecordingStore } from "./store";

export type RecorderState = "idle" | "recording" | "paused" | "interrupted" | "stopped" | "failed";

export interface MeetingRecorder {
  readonly state: RecorderState;
  readonly stream: MediaStream | null;
  readonly error: unknown;
  /** Time spent recording; pauses and interruptions are not on the clock. */
  activeMs(): number;
  start(deviceId?: string): Promise<void>;
  pause(): void;
  resume(): void;
  resumeAfterInterrupt(deviceId?: string): Promise<void>;
  switchDevice(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: () => void): () => void;
}

type Language = RecordingPart["language"];

type RecorderDeps = {
  store: RecordingStore;
  userId: string;
  meetingId: string;
  /** Read when `start()` runs; every part of that recording keeps it. */
  language: Language;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor: typeof MediaRecorder;
  now?: () => number;
  newId?: () => string;
  timesliceMs?: number;
  /** The first part's `startedAt` when this continues a recording still on the device. */
  baseStartedAt?: number;
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"] as const;
/** How long a closing part waits for the browser's stop event before it ends with what is stored. */
const STOP_WAIT_MS = 3_000;

/** The part being written now and what it records from. */
type LivePart = { part: RecordingPart; media: MediaRecorder; stream: MediaStream; stopped: Promise<void>; seq: number };

/**
 * Records a meeting into the device-side store, one chunk every `timesliceMs`
 * (spec D2). Pausing silences the track and keeps the file running, so offsets
 * stay wall-clock (spec D8); only an interruption or a device switch closes the
 * part and opens the next one. An interruption is the track ending or muting (a
 * locked phone, an incoming call, an unplugged microphone) or a chunk the store
 * could not save.
 */
export function createMeetingRecorder(deps: RecorderDeps): MeetingRecorder {
  const { store, getUserMedia, MediaRecorderCtor: Recorder } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const listeners = new Set<() => void>();
  let state: RecorderState = "idle";
  let error: unknown = null;
  let live: LivePart | null = null;
  let baseStartedAt = deps.baseStartedAt;
  let language: Language | null = null;
  let recordedMs = 0;
  let runningSince: number | null = null;
  // Every chunk write in arrival order; a failed write is reported (and interrupts) and the next one still runs.
  let writes: Promise<void> = Promise.resolve();
  // start, switch, resume and stop run one at a time.
  let ops: Promise<void> = Promise.resolve();

  const emit = () => listeners.forEach((fn) => fn());
  const setState = (next: RecorderState) => {
    state = next;
    emit();
  };
  const startClock = () => {
    runningSince ??= now();
  };
  const stopClock = () => {
    if (runningSince !== null) recordedMs += now() - runningSince;
    runningSince = null;
  };
  const write = (fn: () => Promise<void>): Promise<void> =>
    (writes = writes.then(fn).catch((cause: unknown) => {
      error = cause;
      emit();
    }));
  const fail = (cause: unknown) => {
    error = cause;
    stopClock();
    setState("failed");
  };
  const run = (fn: () => Promise<void>): Promise<void> => (ops = ops.then(fn).catch(fail));

  function interrupt(cause?: unknown) {
    if (state !== "recording" && state !== "paused") return;
    if (cause !== undefined) error = cause;
    const endedAt = now();
    stopClock();
    setState("interrupted");
    void run(() => closePart(endedAt));
  }

  async function openPart(deviceId: string | undefined) {
    const stream = await getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    try {
      const mimeType = MIME_TYPES.find((type) => Recorder.isTypeSupported?.(type));
      const media = new Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 });
      const startedAt = now();
      const base = baseStartedAt ?? startedAt;
      const part: RecordingPart = {
        id: newId(), userId: deps.userId, meetingId: deps.meetingId, startedAt, lastChunkAt: startedAt,
        endedAt: null, mimeType: media.mimeType || mimeType || "", bytes: 0, language: language ?? deps.language,
        offsetSeconds: Math.round((startedAt - base) / 1000),
      };
      await store.createPart(part);
      // Fixed by the first part that exists: a refused first try leaves the prep screen free to change them.
      baseStartedAt = base;
      language = part.language;
      let markStopped = () => {};
      const next: LivePart = { part, media, stream, stopped: new Promise((resolve) => (markStopped = resolve)), seq: 0 };
      media.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const seq = next.seq++;
        const at = now();
        void write(() =>
          store.appendChunk(part.id, seq, event.data, at).catch((cause: unknown) => {
            // Storage gave out: stop visibly rather than keep recording what cannot be saved.
            if (live === next) interrupt(cause);
            throw cause;
          }),
        );
      };
      media.onstop = () => markStopped();
      media.onerror = () => {
        if (live === next) interrupt();
      };
      for (const track of stream.getTracks()) {
        // iOS mutes rather than ends the track on a screen lock or a call; pause() never mutes it.
        for (const type of ["ended", "mute"]) {
          track.addEventListener(type, () => {
            if (live === next) interrupt();
          });
        }
        // A switch while paused stays paused on the new microphone.
        if (state === "paused") track.enabled = false;
      }
      media.start(deps.timesliceMs ?? 5_000);
      live = next;
      emit();
    } catch (cause) {
      stream.getTracks().forEach((track) => track.stop());
      throw cause;
    }
  }

  /** Waits for the browser's last chunk, releases the microphone and marks the part ended. */
  async function closePart(endedAt: number) {
    const closing = live;
    if (!closing) return;
    live = null;
    // When the track ended the browser may have stopped the recorder already; its stop event should still
    // come, but a part never waits on it for ever: that would hang End-and-send.
    if (closing.media.state !== "inactive") closing.media.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closing.stopped, new Promise<void>((resolve) => (timer = setTimeout(resolve, STOP_WAIT_MS)))]);
    clearTimeout(timer);
    closing.stream.getTracks().forEach((track) => track.stop());
    emit();
    await write(() => store.finishPart(closing.part.id, endedAt));
  }

  return {
    get state() {
      return state;
    },
    get stream() {
      return live?.stream ?? null;
    },
    get error() {
      return error;
    },
    activeMs: () => recordedMs + (runningSince === null ? 0 : now() - runningSince),
    start: (deviceId) =>
      run(async () => {
        if (state !== "idle" && state !== "failed") return;
        error = null;
        await openPart(deviceId);
        startClock();
        setState("recording");
      }),
    pause() {
      if (state !== "recording") return;
      live?.stream.getTracks().forEach((track) => (track.enabled = false));
      stopClock();
      setState("paused");
    },
    resume() {
      if (state !== "paused") return;
      live?.stream.getTracks().forEach((track) => (track.enabled = true));
      startClock();
      setState("recording");
    },
    resumeAfterInterrupt: (deviceId) =>
      run(async () => {
        if (state !== "interrupted") return;
        error = null;
        await openPart(deviceId);
        startClock();
        setState("recording");
      }),
    switchDevice: (deviceId) =>
      run(async () => {
        if (state !== "recording" && state !== "paused") return;
        await closePart(now());
        await openPart(deviceId);
      }),
    stop: () =>
      run(async () => {
        if (state !== "recording" && state !== "paused" && state !== "interrupted") return;
        const endedAt = now();
        stopClock();
        await closePart(endedAt);
        await writes;
        setState("stopped");
      }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
