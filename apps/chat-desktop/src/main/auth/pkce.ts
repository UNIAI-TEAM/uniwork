import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

/** RFC 7636 verifier bounds; the alphabet is the RFC's unreserved ASCII set. */
const PKCE_VERIFIER_MIN_LENGTH = 43;
const PKCE_VERIFIER_MAX_LENGTH = 128;
const PKCE_VERIFIER_LENGTH = 64;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]+$/;

type RandomBytes = (size: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (size) => nodeRandomBytes(size);

function assertCodeVerifier(verifier: string): void {
  if (
    verifier.length < PKCE_VERIFIER_MIN_LENGTH ||
    verifier.length > PKCE_VERIFIER_MAX_LENGTH ||
    !VERIFIER_PATTERN.test(verifier)
  ) {
    throw new Error("Invalid RFC 7636 code verifier");
  }
}

/** A high-entropy verifier from the host CSPRNG (64 base64url characters). */
export function generateCodeVerifier(source: RandomBytes = defaultRandomBytes): string {
  const bytes = source(PKCE_VERIFIER_LENGTH);
  if (bytes.byteLength < PKCE_VERIFIER_LENGTH) throw new Error("CSPRNG returned too few bytes");
  const verifier = Buffer.from(bytes).toString("base64url").slice(0, PKCE_VERIFIER_LENGTH);
  assertCodeVerifier(verifier);
  return verifier;
}

/** S256: BASE64URL(SHA-256(ASCII(verifier))) without padding, never hex. */
export function createCodeChallenge(verifier: string): string {
  assertCodeVerifier(verifier);
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function generateOpaqueValue(prefix: string, source: RandomBytes): string {
  const value = Buffer.from(source(32)).toString("base64url");
  if (value.length < 32) throw new Error("CSPRNG returned too few bytes");
  return `${prefix}_${value}`;
}

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export interface PendingLoginAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly codeChallenge: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly redirectUri: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** authorization_url returned by start (re-opened by a second login click) */
  authorizationUrl?: string;
}

/**
 * In-memory by design: a restart loses the verifier and needs a new sign-in.
 * Only one attempt lives at a time, so a fresh sign-in invalidates the old
 * verifier and parallel callbacks cannot race a session.
 */
export class LoginAttemptStore {
  private attempt: PendingLoginAttempt | undefined;
  private readonly source: RandomBytes;
  private readonly ttlMs: number;

  constructor(options: { randomBytes?: RandomBytes; ttlMs?: number } = {}) {
    this.source = options.randomBytes ?? defaultRandomBytes;
    this.ttlMs = options.ttlMs ?? LOGIN_ATTEMPT_TTL_MS;
  }

  begin(config: { clientId: string; deploymentId: string; redirectUri: string; now: number }): PendingLoginAttempt {
    const verifier = generateCodeVerifier(this.source);
    this.attempt = {
      state: generateOpaqueValue("state", this.source),
      verifier,
      codeChallenge: createCodeChallenge(verifier),
      clientId: config.clientId,
      deploymentId: config.deploymentId,
      redirectUri: config.redirectUri,
      createdAt: config.now,
      expiresAt: config.now + this.ttlMs,
    };
    return this.attempt;
  }

  /** the live attempt; an expired one is dropped and reported as absent */
  current(now: number): PendingLoginAttempt | undefined {
    if (this.attempt && this.attempt.expiresAt <= now) this.attempt = undefined;
    return this.attempt;
  }

  /** the attempt regardless of expiry (callback validation reports `expired`) */
  peek(): PendingLoginAttempt | undefined {
    return this.attempt;
  }

  cancel(): boolean {
    const had = this.attempt !== undefined;
    this.attempt = undefined;
    return had;
  }
}
