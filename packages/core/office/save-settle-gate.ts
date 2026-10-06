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
 * A Save whose request never answers must not hold drafts back forever (a
 * crash would lose every edit made after it started). So a parked capture
 * waits at most `maxWaitMs`, then captures while the Save is still in flight
 * and writes under the base still bound: the Save has not rebased anything
 * yet. The Save calls `markRebase` once its write is confirmed, before it
 * moves the editor or the identity; from then until it settles, captures wait
 * (that part is local work), and a capture that straddled the mark is taken
 * again. The Save's own draft rebase then moves the row written under the old
 * base.
 */
export interface SaveSettleGate {
  /** Runs one Save; checkpoints wait until every Save in flight settled. */
  run<T>(save: () => Promise<T>): Promise<T>;
  /** Called by a Save in `run` once its write is confirmed, before it rebases
   *  the editor or advances the draft identity. */
  markRebase(): void;
  /** Captures a snapshot no Save overlapped and hands it to `write` in the
   *  same turn. `write` must bind the identity it writes under synchronously. */
  capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>>;
}

const DEFAULT_MAX_WAIT_MS = 10_000;

export function createSaveSettleGate(options: {
  /** How long a parked capture waits for a Save in flight before it writes
   *  under the pre-rebase base. */
  maxWaitMs?: number;
} = {}): SaveSettleGate {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  let inFlight = 0;
  let epoch = 0;
  // `rebasing` holds from a Save's mark until every Save in flight settled.
  let rebasing = false;
  let rebaseEpoch = 0;
  let waiters: Array<() => void> = [];

  const settled = (): Promise<void> | null => (inFlight === 0 ? null : new Promise<void>((resolve) => { waiters.push(resolve); }));

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
          if (rebasing) {
            rebasing = false;
            rebaseEpoch += 1;
          }
          const released = waiters;
          waiters = [];
          for (const resolve of released) resolve();
        }
      }
    },
    markRebase() {
      rebaseEpoch += 1;
      if (inFlight > 0) rebasing = true;
    },
    async capture<S, R>(capture: () => Promise<S>, write: (snapshot: S) => R): Promise<Awaited<R>> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expiry: Promise<void> | undefined;
      let expired = false;
      try {
        for (;;) {
          const waiting = settled();
          if (waiting && (rebasing || !expired)) {
            if (!rebasing) {
              // One bound per capture, from the first time it parks.
              expiry ??= new Promise<void>((resolve) => { timer = setTimeout(() => { expired = true; resolve(); }, maxWaitMs); });
              await Promise.race([waiting, expiry]);
            } else {
              await waiting;
            }
            continue;
          }
          const started = epoch;
          const startedRebase = rebaseEpoch;
          const snapshot = await capture();
          const noRebase = !rebasing && rebaseEpoch === startedRebase;
          if (noRebase && (expired || (inFlight === 0 && epoch === started))) return await write(snapshot);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
