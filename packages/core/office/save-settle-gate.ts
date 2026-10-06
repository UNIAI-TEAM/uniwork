/**
 * Orders draft checkpoints against Saves for every Office host (web and
 * desktop, every format).
 *
 * A Save that commits rebases the editor onto the saved bytes and advances the
 * identity the draft row is keyed by. A snapshot read before that rebase but
 * written after it would store a pre-rebase journal under the new base, and
 * recovery would replay the saved prefix twice. Waiting for the Save to settle
 * is not enough on its own: a capture that started before the Save can resolve
 * after it (a digest yields to the event loop).
 *
 * So the gate is structural, not timed: every Save runs inside `run`, which
 * bumps an epoch when it starts and when it settles. `capture` waits until no
 * Save is in flight, captures, and accepts the snapshot only if no Save
 * started or settled while it was captured; otherwise it captures again.
 * `write` then runs synchronously in the same turn, so whatever base it reads
 * is the base the snapshot was taken under.
 *
 * No wait is unbounded. A Save whose request never answers must not hold
 * drafts back forever (a crash would lose every edit made after it started),
 * so a parked capture waits at most `maxWaitMs` in all, then captures while
 * the Save is still in flight and writes under the identity bound at that
 * moment. To keep such a capture from writing a pre-rebase journal under a
 * moved base, a Save brackets its rebase: `markRebase` right before a
 * synchronous rebase step, `rebase` around an asynchronous one. A capture
 * that overlaps either is taken again; the rebase itself holds nobody back.
 */
export interface SaveSettleGate {
  /** Runs one Save; checkpoints wait until every Save in flight settled. */
  run<T>(save: () => Promise<T>): Promise<T>;
  /** Called by a Save right before a synchronous step that rebases the editor
   *  or advances the draft identity, in the same turn. */
  markRebase(): void;
  /** Runs an asynchronous rebase step; a capture overlapping it is retaken. */
  rebase<T>(step: () => Promise<T>): Promise<T>;
  /** Captures a snapshot no Save overlapped and hands it to `write` in the
   *  same turn. `write` must bind the identity it writes under synchronously. */
  capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>>;
  /** Captures currently parked behind a Save (diagnostics). */
  parkedCaptures(): number;
  /** Wakes every parked capture at once and stops new ones from parking;
   *  the session's own disposed guard then refuses their writes. */
  dispose(): void;
}

const DEFAULT_MAX_WAIT_MS = 10_000;

export function createSaveSettleGate(options: {
  /** How long a capture waits, in all, for Saves in flight before it writes
   *  under the identity still bound. */
  maxWaitMs?: number;
} = {}): SaveSettleGate {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  let inFlight = 0;
  let epoch = 0;
  let rebaseEpoch = 0;
  let disposed = false;
  // Each parked capture's wake-up; it removes itself, whoever calls it.
  const parked = new Set<() => void>();
  const wakeAll = () => { for (const wake of [...parked]) wake(); };

  return {
    async run(save) {
      inFlight += 1;
      epoch += 1;
      try {
        return await save();
      } finally {
        inFlight -= 1;
        epoch += 1;
        if (inFlight === 0) wakeAll();
      }
    },
    markRebase() {
      rebaseEpoch += 1;
    },
    async rebase(step) {
      rebaseEpoch += 1;
      try {
        return await step();
      } finally {
        rebaseEpoch += 1;
      }
    },
    parkedCaptures: () => parked.size,
    dispose() {
      disposed = true;
      wakeAll();
    },
    async capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>> {
      // One bound per capture, counted from the first time it parks; a timer
      // only runs while the capture is parked.
      let deadline: number | undefined;
      let expired = false;
      for (;;) {
        if (inFlight > 0 && !expired && !disposed) {
          deadline ??= Date.now() + maxWaitMs;
          const remaining = deadline - Date.now();
          if (remaining <= 0) { expired = true; continue; }
          await new Promise<void>((resolve) => {
            // `wake` runs only after this executor returns, so `timer` is set.
            const wake = () => {
              parked.delete(wake);
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => { expired = true; wake(); }, remaining);
            parked.add(wake);
          });
          continue;
        }
        const started = epoch;
        const startedRebase = rebaseEpoch;
        const snapshot = await capture();
        if (rebaseEpoch !== startedRebase) continue;
        if (expired || disposed || (inFlight === 0 && epoch === started)) return await write(snapshot);
      }
    },
  };
}
