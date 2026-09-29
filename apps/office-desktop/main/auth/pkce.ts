import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

/** RFC 7636 verifier bounds. The alphabet is intentionally the RFC's
 * unreserved ASCII set; no Unicode or padding can enter an exchange. */
export const PKCE_VERIFIER_MIN_LENGTH = 43;
export const PKCE_VERIFIER_MAX_LENGTH = 128;
export const PKCE_VERIFIER_LENGTH = 64;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]+$/;

export type RandomBytes = (size: number) => Uint8Array;

function randomBytes(size: number): Uint8Array {
  return nodeRandomBytes(size);
}

/** Generate a high entropy RFC 7636 verifier using the host CSPRNG. */
export function generateCodeVerifier(source: RandomBytes = randomBytes): string {
  const bytes = source(PKCE_VERIFIER_LENGTH);
  if (bytes.byteLength < PKCE_VERIFIER_LENGTH) throw new Error("CSPRNG returned too few bytes");
  const verifier = Buffer.from(bytes).toString("base64url").slice(0, PKCE_VERIFIER_LENGTH);
  assertCodeVerifier(verifier);
  return verifier;
}

export function assertCodeVerifier(verifier: string): void {
  if (verifier.length < PKCE_VERIFIER_MIN_LENGTH || verifier.length > PKCE_VERIFIER_MAX_LENGTH || !VERIFIER_PATTERN.test(verifier)) {
    throw new Error("Invalid RFC 7636 code verifier");
  }
  // RFC 7636 defines ASCII octets. The character expression above is ASCII,
  // but this explicit check keeps the invariant obvious if it changes later.
  if ([...verifier].some((character) => character.charCodeAt(0) > 0x7f)) throw new Error("Code verifier must be ASCII");
}

export function createCodeChallenge(verifier: string): string {
  assertCodeVerifier(verifier);
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function generateOpaqueValue(prefix: string, source: RandomBytes = randomBytes): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,24}$/.test(prefix)) throw new Error("Invalid opaque value prefix");
  const value = Buffer.from(source(32)).toString("base64url");
  if (value.length < 32) throw new Error("CSPRNG returned too few bytes");
  return `${prefix}_${value}`;
}

export type PkcePair = Readonly<{ verifier: string; challenge: string }>;

export function createPkcePair(source: RandomBytes = randomBytes): PkcePair {
  const verifier = generateCodeVerifier(source);
  return Object.freeze({ verifier, challenge: createCodeChallenge(verifier) });
}

