// Ported from apps/chat-desktop/src/main/auth/pkce.ts: node:crypto and Buffer
// replaced by expo-crypto (async) and a hand-rolled base64url, since Hermes
// has neither Buffer nor a binary-safe btoa.
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytesAsync } from "expo-crypto";

/** RFC 7636 verifier bounds; the alphabet is the RFC's unreserved ASCII set. */
const PKCE_VERIFIER_MIN_LENGTH = 43;
const PKCE_VERIFIER_MAX_LENGTH = 128;
const PKCE_VERIFIER_LENGTH = 64;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]+$/;

export type RandomBytes = (size: number) => Promise<Uint8Array>;
/** SHA-256 of the ASCII input as base64url without padding */
export type Sha256 = (ascii: string) => Promise<string>;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url without padding (RFC 4648 §5) */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = ((bytes[i] as number) << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64URL.charAt((triple >> 18) & 63) + B64URL.charAt((triple >> 12) & 63);
    if (b1 !== undefined) out += B64URL.charAt((triple >> 6) & 63);
    if (b2 !== undefined) out += B64URL.charAt(triple & 63);
  }
  return out;
}

const defaultRandomBytes: RandomBytes = (size) => getRandomBytesAsync(size);
const defaultSha256: Sha256 = async (ascii) =>
  (await digestStringAsync(CryptoDigestAlgorithm.SHA256, ascii, { encoding: CryptoEncoding.BASE64 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function assertCodeVerifier(verifier: string): void {
  if (
    verifier.length < PKCE_VERIFIER_MIN_LENGTH ||
    verifier.length > PKCE_VERIFIER_MAX_LENGTH ||
    !VERIFIER_PATTERN.test(verifier)
  ) {
    throw new Error("Invalid RFC 7636 code verifier");
  }
}

/** A high-entropy verifier from the OS CSPRNG (64 base64url characters). */
export async function generateCodeVerifier(source: RandomBytes = defaultRandomBytes): Promise<string> {
  const bytes = await source(PKCE_VERIFIER_LENGTH);
  if (bytes.byteLength < PKCE_VERIFIER_LENGTH) throw new Error("CSPRNG returned too few bytes");
  const verifier = base64UrlEncode(bytes).slice(0, PKCE_VERIFIER_LENGTH);
  assertCodeVerifier(verifier);
  return verifier;
}

/** S256: BASE64URL(SHA-256(ASCII(verifier))) without padding, never hex. */
export async function createCodeChallenge(verifier: string, sha256: Sha256 = defaultSha256): Promise<string> {
  assertCodeVerifier(verifier);
  return sha256(verifier);
}

async function generateOpaqueValue(prefix: string, source: RandomBytes): Promise<string> {
  const value = base64UrlEncode(await source(32));
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
}

/**
 * In-memory by design: a relaunch loses the verifier and needs a new sign-in.
 * Only one attempt lives at a time, so a fresh sign-in invalidates the old
 * verifier and parallel callbacks cannot race a session.
 */
export class LoginAttemptStore {
  private attempt: PendingLoginAttempt | undefined;
  private readonly source: RandomBytes;
  private readonly sha256: Sha256;
  private readonly ttlMs: number;

  constructor(options: { randomBytes?: RandomBytes; sha256?: Sha256; ttlMs?: number } = {}) {
    this.source = options.randomBytes ?? defaultRandomBytes;
    this.sha256 = options.sha256 ?? defaultSha256;
    this.ttlMs = options.ttlMs ?? LOGIN_ATTEMPT_TTL_MS;
  }

  async begin(config: {
    clientId: string;
    deploymentId: string;
    redirectUri: string;
    now: number;
  }): Promise<PendingLoginAttempt> {
    const verifier = await generateCodeVerifier(this.source);
    this.attempt = {
      state: await generateOpaqueValue("state", this.source),
      verifier,
      codeChallenge: await createCodeChallenge(verifier, this.sha256),
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
