"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createMeetingRecorder, type MeetingRecorder, type RecorderState } from "./recorder";
import { isLivePart, openRecordingStore, type RecordingPart, type RecordingStore } from "./store";

let sharedStore: RecordingStore | null = null;
export function defaultStore(): RecordingStore {
  return (sharedStore ??= openRecordingStore());
}

type Language = RecordingPart["language"];

/**
 * The browser's recorder for one meeting. The language is read when recording
 * starts, so the prep screen may change it until then. Holds the screen awake
 * while recording or paused, and asks before the tab closes on a recording that
 * has not been ended. Leaving the screen ends the recording; what was recorded
 * stays on the device. A new `userId`, `meetingId` or `store` is a new recorder, so
 * pass a stable store.
 */
export function useMeetingRecorder(opts: {
  userId: string;
  meetingId: string;
  language: Language;
  /** The first stored part's `startedAt` when this continues a recording still on the device; read at `start()`. */
  baseStartedAt?: number;
  store?: RecordingStore;
}): {
  recorder: MeetingRecorder;
  state: RecorderState;
  activeMs: number;
  wakeLockHeld: boolean;
} {
  const { userId, meetingId, store } = opts;
  const language = useRef(opts.language);
  language.current = opts.language;
  const baseStartedAt = useRef(opts.baseStartedAt);
  baseStartedAt.current = opts.baseStartedAt;
  const recorder = useMemo(
    () =>
      createMeetingRecorder({
        store: store ?? defaultStore(),
        userId,
        meetingId,
        get language() {
          return language.current;
        },
        get baseStartedAt() {
          return baseStartedAt.current;
        },
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        MediaRecorderCtor: globalThis.MediaRecorder,
      }),
    [userId, meetingId, store],
  );
  const state = useSyncExternalStore(recorder.subscribe, () => recorder.state, () => recorder.state);
  // Re-render when only the error changes (a failed write after the state already moved).
  useSyncExternalStore(recorder.subscribe, () => recorder.error, () => recorder.error);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [wakeLockHeld, setWakeLockHeld] = useState(false);
  const holding = state === "recording" || state === "paused";
  const unended = holding || state === "interrupted";

  useEffect(() => () => void recorder.stop(), [recorder]);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (!unended) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome before 119 only asks when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unended]);

  useEffect(() => {
    const wakeLock = typeof navigator === "undefined" ? undefined : (navigator.wakeLock as WakeLock | undefined);
    if (!holding || !wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = () => {
      if (sentinel && !sentinel.released) return;
      wakeLock.request("screen").then(
        (held) => {
          if (disposed) return void held.release();
          sentinel = held;
          setWakeLockHeld(true);
          held.addEventListener("release", () => setWakeLockHeld(false));
        },
        () => setWakeLockHeld(false),
      );
    };
    // The browser drops the lock whenever the page is hidden; take it again on return.
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
      setWakeLockHeld(false);
    };
  }, [holding]);

  return { recorder, state, activeMs: recorder.activeMs(), wakeLockHeld };
}

/**
 * The recordings still on this device for the account (and meeting), oldest first. `seconds`,
 * `savedAt` and `discard` leave out a part another tab is still writing (`isLivePart`); while one
 * is, the list is read again every 5 s, so it settles once that tab stops.
 */
export function useUnsentRecordings(userId: string | undefined, meetingId?: string, store?: RecordingStore): {
  parts: RecordingPart[];
  /** Recorded seconds of the parts no tab is writing. */
  seconds: number;
  /** The last save of the parts no tab is writing; null when there are none. */
  savedAt: number | null;
  /** The device store has not answered yet: `parts` is not known to be empty. */
  isPending: boolean;
  /** Reads the device again; resolves with every part. */
  refresh: () => Promise<RecordingPart[]>;
  /** Deletes the parts no tab is writing, then reads the device again. */
  discard: () => Promise<void>;
} {
  const { data: parts = [], isPending, refetch } = useQuery({
    queryKey: ["meeting-recordings-local", userId, meetingId],
    queryFn: () => (store ?? defaultStore()).listParts(userId!, meetingId),
    enabled: userId !== undefined,
    // The device, not the network: always read it afresh (another screen of this tab may have written it).
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.some((p) => isLivePart(p, Date.now())) ? 5_000 : false),
  });
  const now = Date.now();
  const settled = parts.filter((p) => !isLivePart(p, now));
  const seconds = settled.reduce((sum, p) => sum + ((p.endedAt ?? p.lastChunkAt) - p.startedAt) / 1000, 0);
  const savedAt = settled.length ? Math.max(...settled.map((p) => p.lastChunkAt)) : null;
  const refresh = async () => (userId === undefined ? [] : ((await refetch()).data ?? []));
  const discard = async () => {
    const target = store ?? defaultStore();
    await Promise.all(settled.map((p) => target.deletePart(p.id)));
    await refresh();
  };
  return { parts, seconds, savedAt, isPending, refresh, discard };
}
