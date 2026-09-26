// auth-model.mjs — DOC-005 (UNI-669) desktop login reference model.
// Node 22 built-ins only. No HTTP server, no product imports.
//
// Reference model of the authorization-code + PKCE flow the contract specifies:
// the desktop opens the system browser at an authorize URL, the browser returns
// to the fixed custom scheme uniwork-office://auth/callback, and the client
// exchanges the one-time code plus its private verifier for a device session.
// Models the semantics (TTL, one use, challenge binding, redirect binding,
// state binding); it is NOT product auth and NOT tenant isolation.
//
// Three defects from the earlier harness this module closes by construction:
//   1. The challenge was hex SHA-256. RFC 7636 §4.2 is
//      BASE64URL(SHA256(ASCII(verifier))), so a standards-compliant client and a
//      hex server can never agree. pkce.mjs owns the encoding; this module uses it.
//   2. There was no client: no verifier, no state and no pending attempt, so the
//      callback was never bound to the attempt that started it. createClient owns
//      one pending attempt per begin() and refuses a callback whose state, redirect
//      or TTL does not match that attempt.
//   3. A code was bound to the account and challenge only. It is now bound to
//      account + challenge + exact redirect, and is short-lived and single-use.

import crypto from "node:crypto";

import { REDIRECT_URI } from "./redirect.mjs";
import { generateState, generateVerifier, isVerifierShaped, pkceChallenge } from "./pkce.mjs";

export { REDIRECT_URI } from "./redirect.mjs";
export { pkceChallenge, generateState, generateVerifier } from "./pkce.mjs";

/**
 * @param {object} opts
 * @param {() => number} opts.now            injectable clock (TTL math)
 * @param {Map} opts.sessions                session store owned by the caller
 * @param {(code: string, fields?: object) => never} opts.fail
 *        thrower for the caller's error type. Codes used here: forbidden,
 *        authorization_code_expired, authorization_code_reused.
 * @param {string} opts.redirectUri          exact allowlisted callback
 * @param {number} opts.codeTtlMs            authorization-code lifetime
 * @param {number} opts.accessTtlMs          issued session lifetime
 */
export function createAuthModel({
  now = () => Date.now(),
  sessions,
  fail,
  redirectUri = REDIRECT_URI,
  codeTtlMs = 60_000,
  accessTtlMs = 15 * 60_000,
} = {}) {
  if (!(sessions instanceof Map)) throw new TypeError("sessions must be a Map");
  if (typeof fail !== "function") throw new TypeError("fail must be a function");
  const codes = new Map();

  /**
   * Server half of the authorize step. The client has already generated its
   * verifier and derived the challenge; the server only validates that the
   * challenge is a well-formed S256 value and that the redirect is the one exact
   * callback UniWork Office registers, then issues a short-lived code.
   */
  function authorize({ accountId, codeChallenge, method = "S256", redirect = redirectUri, ttlMs = codeTtlMs } = {}) {
    if (!accountId) fail("forbidden", { reason: "account_required" });
    if (method !== "S256") fail("forbidden", { reason: "code_challenge_method" });
    if (typeof codeChallenge !== "string" || !/^[A-Za-z0-9\-_]{43}$/.test(codeChallenge)) {
      fail("forbidden", { reason: "code_challenge_malformed" });
    }
    // The exact-callback check is the whole defence against another installed
    // app (GenOffice) claiming the deep link: anything but this string is refused
    // before a code exists. A near miss such as a trailing slash is still a miss.
    if (redirect !== redirectUri) fail("forbidden", { reason: "redirect_uri" });
    const code = "code-" + crypto.randomUUID();
    codes.set(code, {
      accountId,
      codeChallenge,
      redirect,
      expiresAt: now() + ttlMs,
      redeemed: false,
    });
    return { code, expiresAt: now() + ttlMs, redirect };
  }

  /**
   * Server half of the exchange step. Everything that can refuse an exchange is
   * decided here and the code is burned exactly once.
   */
  function redeem({ code, verifier, redirect = redirectUri } = {}) {
    const entry = codes.get(code);
    if (!entry) fail("authorization_code_expired", { reason: "unknown_code" });
    // Reuse is checked before the TTL so a replayed code reports the replay, not
    // a generic expiry: the client must tell "asked twice" apart from "too slow".
    if (entry.redeemed) fail("authorization_code_reused");
    if (entry.expiresAt <= now()) fail("authorization_code_expired", { reason: "ttl" });
    if (redirect !== entry.redirect) fail("forbidden", { reason: "redirect_uri" });
    if (!isVerifierShaped(verifier)) fail("forbidden", { reason: "verifier_malformed" });
    // PKCE: the private verifier must hash to the challenge registered at
    // authorize time, so a code lifted from a log or a redirect is useless.
    if (pkceChallenge(verifier) !== entry.codeChallenge) fail("forbidden", { reason: "verifier_mismatch" });
    entry.redeemed = true;
    const sessionId = "sess-" + crypto.randomUUID();
    sessions.set(sessionId, {
      accountId: entry.accountId,
      revoked: false,
      accessExpiresAt: now() + accessTtlMs,
      issuedAt: now(),
    });
    return { sessionId, accountId: entry.accountId };
  }

  function revoke(sessionId) {
    const session = sessions.get(sessionId);
    if (session) session.revoked = true;
  }

  function expireAccess(sessionId) {
    const session = sessions.get(sessionId);
    if (session) session.accessExpiresAt = 0;
  }

  return { authorize, redeem, revoke, expireAccess, codes };
}

/**
 * Client half. One pending attempt per begin(): the verifier never leaves the
 * client, and complete() refuses any callback whose state or redirect does not
 * belong to that attempt. This is the binding the earlier harness lacked.
 */
export function createClient({
  auth,
  now = () => Date.now(),
  fail,
  redirectUri = REDIRECT_URI,
  attemptTtlMs = 5 * 60_000,
} = {}) {
  if (!auth || typeof auth.authorize !== "function") throw new TypeError("auth model required");
  if (typeof fail !== "function") throw new TypeError("fail must be a function");
  const attempts = new Map();

  function begin({ accountId } = {}) {
    const verifier = generateVerifier();
    const state = generateState();
    const attemptId = "attempt-" + crypto.randomUUID();
    const challenge = pkceChallenge(verifier);
    const authorized = auth.authorize({ accountId, codeChallenge: challenge, redirect: redirectUri });
    attempts.set(attemptId, {
      attemptId,
      accountId,
      verifier,
      state,
      redirectUri,
      code: authorized.code,
      expiresAt: now() + attemptTtlMs,
    });
    // The authorization request the desktop hands to the system browser. The
    // verifier is deliberately absent; only the challenge travels.
    return {
      attemptId,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      redirectUri,
      authorizationUrl:
        "uniwork://auth/start?code_challenge=" +
        encodeURIComponent(challenge) +
        "&code_challenge_method=S256&state=" +
        encodeURIComponent(state) +
        "&redirect_uri=" +
        encodeURIComponent(redirectUri),
    };
  }

  function complete({ code, state, redirect } = {}) {
    const attempt = [...attempts.values()].find((candidate) => candidate.code === code);
    // An unknown code, an expired attempt and a replayed callback all land in
    // the same bucket on the client: the attempt is not live, so no session.
    if (!attempt) fail("forbidden", { reason: "unknown_attempt" });
    if (attempt.expiresAt <= now()) fail("forbidden", { reason: "attempt_expired" });
    if (state !== attempt.state) fail("forbidden", { reason: "state_mismatch" });
    if (redirect !== attempt.redirectUri) fail("forbidden", { reason: "redirect_uri" });
    const session = auth.redeem({ code, verifier: attempt.verifier, redirect });
    attempts.delete(attempt.attemptId); // consume only on success
    return { sessionId: session.sessionId, accountId: session.accountId, attemptId: attempt.attemptId };
  }

  // The session lifecycle is reached through the client so a caller never has to
  // hold the server object: revocation and access expiry are the two stops the
  // client is allowed to observe, and both delegate to the model that owns the
  // session store.
  return { begin, complete, revoke: auth.revoke, expireAccess: auth.expireAccess, attempts };
}
