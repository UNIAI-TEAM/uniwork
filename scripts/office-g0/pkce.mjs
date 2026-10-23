// pkce.mjs — RFC 7636 (PKCE) S256 helper for the DOC-005 desktop login (UNI-669).
// Node 22 built-ins only: no I/O, no state, no product imports.
//
// Why this file exists as a module instead of an inline helper. The previous
// harness built its code challenge with hex SHA-256. RFC 7636 §4.2 says
// BASE64URL(SHA256(ASCII(code_verifier))); hex and base64url are different
// strings for the same verifier, so a standard desktop client and a hex server
// can never agree and the mismatch looks like a login failure with no cause.
// The RFC's own published vector is pinned in pkce.test.mjs.

import crypto from "node:crypto";

/** The only code_challenge_method the DOC-005 contract accepts. */
export const PKCE_METHOD = "S256";
/** RFC 7636 §4.1: 43..128 characters from the unreserved set. */
export const VERIFIER_MIN_LENGTH = 43;
export const VERIFIER_MAX_LENGTH = 128;
export const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const VERIFIER_PATTERN = /^[A-Za-z0-9-._~]{43,128}$/;

/** base64url without padding, the encoding RFC 7636 §4.2 requires. */
export function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(ASCII(code_verifier))).
 * Returns null for a verifier that is not RFC-shaped, so a caller can classify
 * "malformed verifier" separately from "verifier does not match the challenge".
 */
export function pkceChallenge(verifier) {
  if (typeof verifier !== "string") return null;
  return base64url(crypto.createHash("sha256").update(verifier, "ascii").digest());
}

export function isVerifierShaped(verifier) {
  return typeof verifier === "string" && VERIFIER_PATTERN.test(verifier);
}

/**
 * A fresh verifier: 64 characters drawn from the RFC 7636 unreserved set using
 * rejection sampling, so every character is uniform and the result is always in
 * the 43..128 range the RFC requires.
 */
export function generateVerifier(length = 64) {
  if (!Number.isInteger(length) || length < VERIFIER_MIN_LENGTH || length > VERIFIER_MAX_LENGTH) {
    throw new RangeError("verifier length must be an integer in [43,128]");
  }
  const limit = Math.floor(256 / VERIFIER_ALPHABET.length) * VERIFIER_ALPHABET.length;
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (byte >= limit) continue; // reject to keep the distribution uniform
      out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** An unguessable, opaque anti-CSRF state parameter for one login attempt. */
export function generateState() {
  return base64url(crypto.randomBytes(32));
}
