import { randomBytes as nodeRandomBytes } from "node:crypto";
import { createPkcePair, generateOpaqueValue, type RandomBytes } from "./pkce";

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export type LoginAttemptConfig = Readonly<{
  clientId: string;
  deploymentId: string;
  redirectUri: string;
  now?: number;
  ttlMs?: number;
}>;

export type PendingLoginAttempt = Readonly<{
  attemptId: string;
  state: string;
  verifier: string;
  codeChallenge: string;
  clientId: string;
  deploymentId: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}>;

export type AttemptStoreOptions = Readonly<{ randomBytes?: RandomBytes; ttlMs?: number }>;

/** In-memory by design for 03a: a process restart loses the verifier. */
export class LoginAttemptStore {
  private readonly attempts = new Map<string, PendingLoginAttempt>();
  private readonly source: RandomBytes;
  private readonly ttlMs: number;

  constructor(options: AttemptStoreOptions = {}) {
    this.source = options.randomBytes ?? ((size) => nodeRandomBytes(size));
    this.ttlMs = options.ttlMs ?? LOGIN_ATTEMPT_TTL_MS;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error("Attempt TTL must be a positive integer");
  }

  begin(config: LoginAttemptConfig): PendingLoginAttempt {
    const now = config.now ?? Date.now();
    const ttl = config.ttlMs ?? this.ttlMs;
    if (!Number.isFinite(now) || !Number.isInteger(now)) throw new Error("Attempt clock must be an integer timestamp");
    if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("Attempt TTL must be a positive integer");
    this.prune(now);
    // Only one live attempt is allowed. Starting a fresh login invalidates the
    // old verifier, which prevents parallel callbacks from racing a session.
    this.attempts.clear();
    const pair = createPkcePair(this.source);
    const attempt: PendingLoginAttempt = Object.freeze({
      attemptId: generateOpaqueValue("attempt", this.source),
      state: generateOpaqueValue("state", this.source),
      verifier: pair.verifier,
      codeChallenge: pair.challenge,
      clientId: config.clientId,
      deploymentId: config.deploymentId,
      redirectUri: config.redirectUri,
      createdAt: now,
      expiresAt: now + ttl,
    });
    this.attempts.set(attempt.attemptId, attempt);
    return attempt;
  }

  get(attemptId: string, now = Date.now()): PendingLoginAttempt | undefined {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.expiresAt <= now) {
      if (attempt) this.attempts.delete(attemptId);
      return undefined;
    }
    return attempt;
  }

  current(now = Date.now()): PendingLoginAttempt | undefined {
    this.prune(now);
    return this.attempts.values().next().value as PendingLoginAttempt | undefined;
  }

  consume(attemptId: string, now = Date.now()): PendingLoginAttempt | undefined {
    const attempt = this.get(attemptId, now);
    if (!attempt) return undefined;
    this.attempts.delete(attemptId);
    return attempt;
  }

  cancel(attemptId?: string): boolean {
    if (attemptId === undefined) {
      const hadAttempt = this.attempts.size > 0;
      this.attempts.clear();
      return hadAttempt;
    }
    return this.attempts.delete(attemptId);
  }

  clear(): void { this.attempts.clear(); }
  size(): number { return this.attempts.size; }

  private prune(now: number): void {
    for (const [id, attempt] of this.attempts) if (attempt.expiresAt <= now) this.attempts.delete(id);
  }
}
