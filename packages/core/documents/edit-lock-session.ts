import type {
  AcquireDocumentEditLockBody,
  DocumentEditHeartbeat,
  DocumentEditLock,
  DocumentEditLockClient,
} from "../api/endpoints/documents-edit-lock";
import { ApiError } from "../api/http";
import { forgetHeldEditLock, registerHeldEditLock } from "./edit-lock-registry";

/**
 * One editor's hold on a document's edit lock (UNI-1645, addendum §9):
 * acquire on open, heartbeat every `heartbeat_interval_ms`, release on close,
 * and turn read-only when the lock is lost.
 *
 *  - Time is a monotonic clock read by the client only; the server's
 *    timestamps are never compared with it. The editor turns read-only once
 *    `ttl_ms` passes since the last successful heartbeat (edge 6), even with
 *    every request still pending.
 *  - Waking (`visibilitychange` to visible, `online`, `focus`) heartbeats at
 *    once (edge 13). A lock that expired while the tab slept is taken back
 *    when the host says the base has not moved; otherwise it stays lost with
 *    `baseChanged` so the host takes the conflict path.
 *  - "acquiring" is never read-only: content shows and only input waits
 *    (§9 FE-8); `slow` turns on after 1 s for the header spinner.
 *
 * It is transport-agnostic like the save machine: production injects the
 * endpoint functions, tests a fake.
 */

type EditLockPhase =
  /** Not started, or the caller cannot edit. */
  | "idle"
  /** R2 in flight. */
  | "acquiring"
  /** This editor holds the lock. */
  | "mine"
  /** Someone (maybe the same person elsewhere) holds it: 423 document_locked. */
  | "other"
  /** The lock was held here and is gone: taken over, handed over, expired… */
  | "lost"
  /** Released by this editor. */
  | "released"
  /** R2 failed for another reason; `errorCode` says which. */
  | "error";

/** The holder a 423 named (no lock id: it is the holder's key). */
interface EditLockHolder {
  id: string;
  name: string;
  since: string;
  expiresAt: string;
  offlineHoldUntil: string | null;
  heldByMe: boolean;
  currentRevision: string | null;
}

export interface EditLockSessionState {
  phase: EditLockPhase;
  /** The held lock while "mine"; its `lock_id` goes on every gated write. */
  lock: DocumentEditLock | null;
  holder: EditLockHolder | null;
  /** `edit_lock_lost.fields.reason` (open set; "expired" also when the client
   *  saw the TTL pass), or "access_lost" for a 403/404 heartbeat. */
  lostReason: string | null;
  lostBy: { id: string; name: string } | null;
  /** Lost by expiry and the host said the base moved: conflict path. */
  baseChanged: boolean;
  errorCode: string | null;
  /** "acquiring" for more than 1 s. */
  slow: boolean;
  /** Only "mine" may type. */
  editable: boolean;
  /** "other" or "lost": the UI says why it is read-only. Never while acquiring. */
  readOnly: boolean;
}

export interface EditLockTransport {
  acquire(body: AcquireDocumentEditLockBody): Promise<DocumentEditLock | null>;
  heartbeat(lockId: string): Promise<DocumentEditHeartbeat | null>;
  release(lockId: string, opts: { keepalive?: boolean }): Promise<void>;
}

export interface EditLockSessionOptions {
  documentId: string;
  client: DocumentEditLockClient;
  transport: EditLockTransport;
  /** Client-minted ULID for this editor open; one is minted when absent. */
  editorId?: string;
  /** Monotonic milliseconds. Default `performance.now()`. */
  now?: () => number;
  /** Subscribe to wake events; returns the unsubscribe. Default: window/document. */
  onWake?: (wake: () => void) => () => void;
  /** After an expiry: may the lock be taken back (the base did not move)? */
  canReclaim?: () => boolean | Promise<boolean>;
}

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_TTL_MS = 120_000;
const SLOW_ACQUIRE_MS = 1_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 48-bit time + 80 random bits, Crockford base32. */
export function newEditorId(time = Date.now()): string {
  let ts = "";
  for (let i = 0, t = time; i < 10; i++, t = Math.floor(t / 32)) ts = CROCKFORD[t % 32] + ts;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let random = "";
  for (const byte of bytes) random += CROCKFORD[byte % 32];
  return ts + random;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function windowWake(wake: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
  };
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function holderFrom(fields: Record<string, unknown> | undefined): EditLockHolder {
  return {
    id: str(fields?.holder_id),
    name: str(fields?.holder_name),
    since: str(fields?.since),
    expiresAt: str(fields?.expires_at),
    offlineHoldUntil: str(fields?.offline_hold_until) || null,
    heldByMe: fields?.held_by_me === true,
    currentRevision: str(fields?.current_revision) || null,
  };
}

/** A status-coded refusal that retrying cannot fix. */
const refused = (err: unknown, ...statuses: number[]): err is ApiError =>
  err instanceof ApiError && statuses.includes(err.status);

export class EditLockSession {
  readonly editorId: string;
  private state: EditLockSessionState = {
    phase: "idle",
    lock: null,
    holder: null,
    lostReason: null,
    lostBy: null,
    baseChanged: false,
    errorCode: null,
    slow: false,
    editable: false,
    readOnly: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private heartbeatMs = DEFAULT_HEARTBEAT_MS;
  private ttlMs = DEFAULT_TTL_MS;
  private lastOk = 0;
  /** The last lock held here, kept after a loss for the post-sleep reclaim. */
  private lastLock: DocumentEditLock | null = null;
  private beatTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private beating = false;
  private reclaiming = false;
  /** Bumped by every acquire and release: a late R2 answer of an older op is stale. */
  private op = 0;
  private started = false;
  private disposed = false;
  private unsubscribeWake: (() => void) | undefined;

  constructor(private readonly opts: EditLockSessionOptions) {
    this.editorId = opts.editorId ?? newEditorId();
    this.now = opts.now ?? monotonicNow;
  }

  getState(): Readonly<EditLockSessionState> {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Open for editing: listen for wake events and acquire. Idempotent. */
  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.unsubscribeWake = (this.opts.onWake ?? windowWake)(() => this.wake());
    void this.acquire();
  }

  /** R2: open, "Edit now" after the lock came free, or "Edit here" with `moveFromSelf`. */
  async acquire(moveFromSelf = false): Promise<void> {
    if (this.disposed || (this.state.phase === "mine" && !moveFromSelf)) return;
    // A second call while R2 flies would bump the op and give back the lock the
    // first one is about to adopt; only "Edit here" may restart it.
    if (this.state.phase === "acquiring" && !moveFromSelf) return;
    const op = ++this.op;
    this.clearTimers();
    this.setState({ phase: "acquiring", holder: null, lostReason: null, lostBy: null, baseChanged: false, errorCode: null, slow: false });
    this.slowTimer = setTimeout(() => {
      if (op === this.op && this.state.phase === "acquiring") this.setState({ slow: true });
    }, SLOW_ACQUIRE_MS);
    try {
      const lock = await this.opts.transport.acquire({
        editor_id: this.editorId,
        client: this.opts.client,
        ...(moveFromSelf ? { move_from_self: true } : {}),
      });
      if (op !== this.op || this.disposed) {
        // Released or torn down while R2 flew: give back what it granted.
        if (lock) void this.opts.transport.release(lock.lock_id, {}).catch(() => undefined);
        return;
      }
      if (!lock) {
        this.failAcquire(null, true);
        return;
      }
      this.grant(lock);
    } catch (err) {
      if (op !== this.op || this.disposed) return;
      if (err instanceof ApiError && err.code === "document_locked") {
        this.clearTimers();
        this.setState({ phase: "other", holder: holderFrom(err.fields), slow: false });
        return;
      }
      this.failAcquire(err instanceof ApiError ? err.code : null, !refused(err, 401, 403, 404));
    }
  }

  /** "Edit here": move the lock from this user's other tab or device. */
  moveHere(): Promise<void> {
    return this.acquire(true);
  }

  /** Hold a lock granted outside R2 (R5 take-over with this editor's id). */
  adopt(lock: DocumentEditLock): void {
    if (this.disposed) return;
    this.op++;
    this.grant(lock);
  }

  /**
   * A gated write answered 423 document_locked while this editor thought it
   * held the lock (addendum §11.1): end the hold the same way a heartbeat's
   * edit_lock_lost does, so every lost-lock surface follows. Ignored unless "mine".
   */
  markLost(reason: string, by: { id: string; name: string } | null = null): void {
    if (this.disposed || this.state.phase !== "mine") return;
    this.op++;
    this.lose(reason, by);
  }

  /** Heartbeat now (a realtime lock frame arrived, or the tab woke). */
  wake(): void {
    if (this.disposed) return;
    switch (this.state.phase) {
      case "mine":
        if (this.expireIfDue()) void this.reclaim();
        else void this.beat();
        return;
      case "lost":
        if (this.state.lostReason === "expired" && !this.state.baseChanged) void this.reclaim();
        return;
      case "error":
        if (this.retryTimer !== undefined) void this.acquire();
        return;
      default:
        return;
    }
  }

  /** R4 on close. With `keepalive` the request outlives the page (pagehide). */
  async release(opts: { keepalive?: boolean } = {}): Promise<void> {
    this.op++;
    this.clearTimers();
    const lock = this.state.phase === "mine" ? this.state.lock : null;
    if (this.state.phase === "mine" || this.state.phase === "acquiring") {
      this.setState({ phase: "released", lock: null, slow: false });
    }
    if (!lock) return;
    forgetHeldEditLock(lock.lock_id);
    try {
      await this.opts.transport.release(lock.lock_id, opts);
    } catch {
      // Best effort: the lock expires after the TTL anyway.
    }
  }

  /** Stop timers and listeners; the caller releases first if it still holds. */
  dispose(): void {
    this.disposed = true;
    this.op++;
    this.clearTimers();
    this.unsubscribeWake?.();
    this.listeners.clear();
  }

  private grant(lock: DocumentEditLock): void {
    this.lastLock = lock;
    this.heartbeatMs = lock.heartbeat_interval_ms || DEFAULT_HEARTBEAT_MS;
    this.ttlMs = lock.ttl_ms || DEFAULT_TTL_MS;
    this.lastOk = this.now();
    registerHeldEditLock(this.opts.documentId, lock.lock_id);
    this.clearTimers();
    this.setState({ phase: "mine", lock, holder: null, lostReason: null, lostBy: null, baseChanged: false, errorCode: null, slow: false });
    this.schedule();
  }

  private failAcquire(code: string | null, retryable: boolean): void {
    this.clearTimers();
    this.setState({ phase: "error", errorCode: code, slow: false });
    if (retryable) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (this.state.phase === "error") void this.acquire();
      }, this.heartbeatMs);
    }
  }

  private schedule(): void {
    this.clearTimers();
    this.beatTimer = setTimeout(() => void this.beat(), this.heartbeatMs);
    const left = Math.max(0, this.ttlMs - (this.now() - this.lastOk));
    this.deadlineTimer = setTimeout(() => this.expireIfDue(), left);
  }

  /** Turn "mine" into lost(expired) once the TTL passed since the last good heartbeat. */
  private expireIfDue(): boolean {
    if (this.state.phase !== "mine" || this.now() - this.lastOk < this.ttlMs) return false;
    this.lose("expired", null);
    return true;
  }

  private async beat(): Promise<void> {
    const lock = this.state.lock;
    if (this.disposed || this.state.phase !== "mine" || !lock || this.beating) return;
    if (this.expireIfDue()) return;
    this.beating = true;
    try {
      const hb = await this.opts.transport.heartbeat(lock.lock_id);
      if (!this.holds(lock)) return;
      if (hb && hb.lock_id === lock.lock_id) {
        this.lastOk = this.now();
        this.setState({ lock: { ...lock, expires_at: hb.expires_at, offline_hold_until: hb.offline_hold_until ?? null } });
      }
    } catch (err) {
      if (!this.holds(lock)) return;
      if (this.loseFrom(err)) return;
      // A network failure: keep trying until the TTL says otherwise.
    } finally {
      this.beating = false;
    }
    if (this.holds(lock) && !this.disposed && !this.expireIfDue()) {
      this.schedule();
    }
  }

  /** Still "mine" on the same tenure (a heartbeat replaces the lock object). */
  private holds(lock: DocumentEditLock): boolean {
    return this.state.phase === "mine" && this.state.lock?.lock_id === lock.lock_id;
  }

  /** Read a heartbeat refusal; true when it ended the lock. */
  private loseFrom(err: unknown): boolean {
    if (err instanceof ApiError && err.code === "edit_lock_lost") {
      const reason = str(err.fields?.reason) || "unknown";
      const byId = str(err.fields?.by_id);
      this.lose(reason, byId ? { id: byId, name: str(err.fields?.by_name) } : null);
      return true;
    }
    if (refused(err, 403, 404)) {
      this.lose("access_lost", null);
      return true;
    }
    return false;
  }

  private lose(reason: string, by: { id: string; name: string } | null): void {
    if (this.state.lock) forgetHeldEditLock(this.state.lock.lock_id);
    this.clearTimers();
    this.setState({ phase: "lost", lock: null, lostReason: reason, lostBy: by, baseChanged: false });
  }

  /**
   * After an expiry (the tab slept or the network was down past the TTL):
   * the old lock may still be live server-side, so heartbeat it first; when
   * the server confirms it expired, take a new one only if the base is
   * unchanged (edge 13). Any other reason stays lost.
   */
  private async reclaim(): Promise<void> {
    const old = this.lastLock;
    if (this.reclaiming || !old || this.disposed) return;
    this.reclaiming = true;
    const op = this.op;
    try {
      let expired = false;
      try {
        const hb = await this.opts.transport.heartbeat(old.lock_id);
        if (op !== this.op || this.state.phase !== "lost") return;
        if (hb && hb.lock_id === old.lock_id) {
          this.grant({ ...old, expires_at: hb.expires_at, offline_hold_until: hb.offline_hold_until ?? null });
          return;
        }
      } catch (err) {
        if (op !== this.op || this.state.phase !== "lost") return;
        if (err instanceof ApiError && err.code === "edit_lock_lost") {
          expired = str(err.fields?.reason) === "expired";
          if (!expired) {
            this.loseFrom(err);
            return;
          }
        } else if (this.loseFrom(err)) {
          return;
        } else {
          return; // still offline; the next wake tries again
        }
      }
      if (!expired) return;
      const unchanged = await (this.opts.canReclaim?.() ?? true);
      if (op !== this.op || this.state.phase !== "lost") return;
      if (!unchanged) {
        this.setState({ baseChanged: true });
        return;
      }
      this.reclaiming = false;
      await this.acquire();
    } finally {
      this.reclaiming = false;
    }
  }

  private clearTimers(): void {
    for (const timer of [this.beatTimer, this.deadlineTimer, this.slowTimer, this.retryTimer]) {
      if (timer !== undefined) clearTimeout(timer);
    }
    this.beatTimer = this.deadlineTimer = this.slowTimer = this.retryTimer = undefined;
  }

  private setState(patch: Partial<EditLockSessionState>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...patch };
    // Whatever way the session leaves "mine", the tab no longer holds that lock.
    if (this.state.phase === "mine" && next.phase !== "mine" && this.state.lock) forgetHeldEditLock(this.state.lock.lock_id);
    next.editable = next.phase === "mine";
    next.readOnly = next.phase === "other" || next.phase === "lost";
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
