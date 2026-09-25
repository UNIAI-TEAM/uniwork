import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  PKCE_METHOD,
  VERIFIER_ALPHABET,
  base64url,
  generateState,
  generateVerifier,
  isVerifierShaped,
  pkceChallenge,
} from "./pkce.mjs";

// The RFC's own vector is the contract: a client and a server that both follow
// RFC 7636 must agree on this exact pair.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test("S256 is the only method and it is BASE64URL, not hex", () => {
  assert.equal(PKCE_METHOD, "S256");
  assert.equal(pkceChallenge(RFC_VERIFIER), RFC_CHALLENGE);
  // The defect this pins: hex SHA-256 is a different string for the same verifier.
  const hex = crypto.createHash("sha256").update(RFC_VERIFIER, "ascii").digest("hex");
  assert.notEqual(pkceChallenge(RFC_VERIFIER), hex);
  assert.equal(hex.length, 64);
  assert.equal(pkceChallenge(RFC_VERIFIER).length, 43, "base64url of 32 bytes is 43 chars, unpadded");
  assert.equal(pkceChallenge(RFC_VERIFIER).includes("="), false, "padding must be stripped");
  assert.match(pkceChallenge(RFC_VERIFIER), /^[A-Za-z0-9\-_]{43}$/);
});

test("a generated verifier is RFC-shaped and its challenge round-trips", () => {
  for (let i = 0; i < 32; i += 1) {
    const verifier = generateVerifier();
    assert.ok(verifier.length >= 43 && verifier.length <= 128, "length out of RFC range");
    assert.equal(isVerifierShaped(verifier), true);
    assert.deepEqual([...new Set(verifier)].filter((ch) => !VERIFIER_ALPHABET.includes(ch)), []);
    assert.match(pkceChallenge(verifier), /^[A-Za-z0-9\-_]{43}$/);
  }
});

test("every permitted character is reachable and the length is honoured", () => {
  assert.equal(generateVerifier(43).length, 43);
  assert.equal(generateVerifier(128).length, 128);
  assert.throws(() => generateVerifier(42), RangeError);
  assert.throws(() => generateVerifier(129), RangeError);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) for (const ch of generateVerifier(128)) seen.add(ch);
  assert.equal(seen.size, VERIFIER_ALPHABET.length, "rejection sampling should reach the whole alphabet");
});

test("states are opaque, unique and unpadded", () => {
  const states = new Set();
  for (let i = 0; i < 200; i += 1) {
    const state = generateState();
    assert.match(state, /^[A-Za-z0-9\-_]{43}$/);
    assert.equal(states.has(state), false, "state collision");
    states.add(state);
  }
});

test("base64url is padding-free and URL-safe", () => {
  assert.equal(base64url(Buffer.from([0xfb, 0xff])), "-_8");
  assert.equal(base64url(Buffer.alloc(0)), "");
});

test("malformed input is not silently turned into a challenge", () => {
  assert.equal(pkceChallenge(undefined), null);
  assert.equal(pkceChallenge(42), null);
  assert.equal(isVerifierShaped("short"), false);
  assert.equal(isVerifierShaped(RFC_VERIFIER + "="), false, "padding is not an RFC 7636 character");
  assert.equal(isVerifierShaped(undefined), false);
});
