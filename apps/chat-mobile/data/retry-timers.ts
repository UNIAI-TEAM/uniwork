// The backoff the phone waits between attempts at something that failed for a
// reason the network may fix: the unsent messages, the queued reads
// and reactions, a socket whose session refresh hit a dead spot. 2 s, 5 s,
// 15 s, then every 60 s, each spread ±20 % so a thousand phones coming back
// from the same outage do not knock together. A network edge or a socket
// reconnect still retries at once; this only covers the time in between.

export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000] as const;
const JITTER = 0.2;

/** The wait before the retry that follows `attempt` failures (0 is the first retry). */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)]!;
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}

export interface RetryTimers {
  /**
   * Runs `run` once after the backoff for this key's failures so far. A key
   * that already waits keeps its timer: a burst of failures is one retry.
   */
  schedule(key: string, run: () => void): void;
  /** It worked: the next failure waits the shortest delay again. */
  reset(key: string): void;
  /** Sign-out: nothing of the last account fires. */
  cancelAll(): void;
}

export function createRetryTimers(random: () => number = Math.random): RetryTimers {
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  const failures = new Map<string, number>();
  return {
    schedule(key, run) {
      if (waiting.has(key)) return;
      const attempt = failures.get(key) ?? 0;
      failures.set(key, attempt + 1);
      waiting.set(
        key,
        setTimeout(() => {
          waiting.delete(key);
          run();
        }, retryDelay(attempt, random)),
      );
    },
    reset(key) {
      clearTimeout(waiting.get(key));
      waiting.delete(key);
      failures.delete(key);
    },
    cancelAll() {
      for (const timer of waiting.values()) clearTimeout(timer);
      waiting.clear();
      failures.clear();
    },
  };
}
