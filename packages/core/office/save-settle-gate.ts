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
 */
export interface SaveSettleGate {
  /** Runs one Save; checkpoints wait until every Save in flight settled. */
  run<T>(save: () => Promise<T>): Promise<T>;
  /** Captures a snapshot no Save overlapped and hands it to `write` in the
   *  same turn. `write` must bind the identity it writes under synchronously. */
  capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>>;
}

export function createSaveSettleGate(): SaveSettleGate {
  let inFlight = 0;
  let epoch = 0;
  let waiters: Array<() => void> = [];

  const idle = (): Promise<void> | null => (inFlight === 0 ? null : new Promise<void>((resolve) => { waiters.push(resolve); }));

  return {
    async run(save) {
      inFlight += 1;
      epoch += 1;
      try {
        return await save();
      } finally {
        inFlight -= 1;
        epoch += 1;
        if (inFlight === 0) {
          const released = waiters;
          waiters = [];
          for (const resolve of released) resolve();
        }
      }
    },
    async capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>> {
      for (;;) {
        const waiting = idle();
        if (waiting) {
          await waiting;
          continue;
        }
        const started = epoch;
        const snapshot = await capture();
        if (inFlight === 0 && epoch === started) return await write(snapshot);
      }
    },
  };
}
