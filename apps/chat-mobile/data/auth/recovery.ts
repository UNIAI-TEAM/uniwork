// The retry a session held through a transient failure (offline, a 5xx, a timeout) runs on its own: one at a time,
// 5 s doubling up to 5 min, back to 5 s once the session is healthy again (MobileSession, session.ts).

/** the first retry after a transient failure; each further one waits twice as long */
export const RECOVERY_MIN_MS = 5_000;
const RECOVERY_MAX_MS = 300_000;
/** 5 s × 2^16 is far past the cap: the count stops growing there */
const MAX_DOUBLINGS = 16;

export class RecoveryTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  /** `run` once after the next delay; a retry already pending is kept, not doubled up. */
  schedule(run: () => void): void {
    if (this.timer) return;
    const delay = Math.min(RECOVERY_MAX_MS, RECOVERY_MIN_MS * 2 ** this.attempts);
    this.attempts = Math.min(this.attempts + 1, MAX_DOUBLINGS);
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, delay);
  }

  /** the pending retry goes; the next failure keeps doubling from where it was */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** the session is healthy: no retry pending, and the next failure starts at the minimum again */
  reset(): void {
    this.clear();
    this.attempts = 0;
  }
}
