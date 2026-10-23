"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * One shared clock per interval, so every row and badge that derives state
 * from the time of day (soon chip, MISSED, OVERTIME, the Join window)
 * re-evaluates together instead of freezing at the render that last happened.
 * Ticks on the wall-clock boundary and again when the tab becomes visible,
 * because background tabs throttle timers.
 */
type Clock = { now: number; listeners: Set<() => void>; stop?: () => void };

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set() };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function start(intervalMs: number, clock: Clock) {
  const emit = () => {
    clock.now = Date.now();
    clock.listeners.forEach((l) => l());
  };
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(
      () => {
        emit();
        schedule();
      },
      intervalMs - (Date.now() % intervalMs) + 20,
    );
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") emit();
  };
  schedule();
  document.addEventListener("visibilitychange", onVisible);
  clock.stop = () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    clock.stop = undefined;
  };
}

/** Current time in ms, refreshed every `intervalMs` (default one minute). */
export function useNow(intervalMs = 60_000): number {
  const clock = clockFor(intervalMs);
  // Stable per interval: an inline subscribe makes React resubscribe on every
  // render, and a lone subscriber would then stop and restart the clock,
  // moving `now` and rendering again without end.
  const subscribe = useCallback(
    (listener: () => void) => {
      const c = clockFor(intervalMs);
      c.listeners.add(listener);
      if (!c.stop) {
        c.now = Date.now();
        start(intervalMs, c);
      }
      return () => {
        c.listeners.delete(listener);
        if (c.listeners.size === 0) c.stop?.();
      };
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => clock.now,
    () => clock.now,
  );
}
