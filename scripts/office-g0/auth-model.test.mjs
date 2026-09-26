import { test } from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "./run-contracts.mjs";
import { createAuthModel, createClient } from "./auth-model.mjs";
import { REDIRECT_URI } from "./redirect.mjs";

const fail = (code, fields) => {
  throw new ProtocolError(code, fields);
};

/** A clock the test moves by hand, so TTL behaviour is measured not assumed. */
const makeClock = (t = 1_000_000) => {
  const clock = { t };
  return { now: () => clock.t, clock };
};

const setup = () => {
  const { now, clock } = makeClock();
  const sessions = new Map();
  const auth = createAuthModel({ now, sessions, fail });
  const client = createClient({ auth, now, fail });
  return { auth, client, sessions, clock };
};

const codeOf = (client, attemptId) => client.attempts.get(attemptId).code;

test("a full honest login yields a session and consumes the attempt", () => {
  const { client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  assert.equal(request.codeChallengeMethod, "S256");
  assert.match(request.authorizationUrl, /code_challenge=/);
  assert.equal(request.authorizationUrl.includes(codeOf(client, request.attemptId)), false, "the code must not be in the authorize URL");
  assert.equal(request.authorizationUrl.includes(client.attempts.get(request.attemptId).verifier), false, "the verifier must never leave the client");
  const result = client.complete({ code: codeOf(client, request.attemptId), state: request.state, redirect: REDIRECT_URI });
  assert.equal(sessions.get(result.sessionId).accountId, "account-a");
  assert.equal(client.attempts.size, 0, "a successful exchange consumes the attempt");
});

test("a callback with the wrong state signs nobody in", () => {
  const { client, sessions } = setup();
  const mine = client.begin({ accountId: "account-a" });
  const other = client.begin({ accountId: "account-b" });
  assert.throws(
    () => client.complete({ code: codeOf(client, mine.attemptId), state: other.state, redirect: REDIRECT_URI }),
    (error) => error.code === "forbidden" && error.fields.reason === "state_mismatch",
  );
  assert.equal(sessions.size, 0);
  // The attempt is untouched, so the honest callback still works.
  client.complete({ code: codeOf(client, mine.attemptId), state: mine.state, redirect: REDIRECT_URI });
  assert.equal(sessions.size, 1);
});

test("a callback to a foreign scheme signs nobody in", () => {
  const { client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  assert.throws(
    () => client.complete({ code: codeOf(client, request.attemptId), state: request.state, redirect: "genoffice://auth/callback" }),
    (error) => error.code === "forbidden" && error.fields.reason === "redirect_uri",
  );
  assert.equal(sessions.size, 0);
});

test("the server refuses a foreign redirect at authorize time, before a code exists", () => {
  const { auth } = setup();
  assert.throws(
    () => auth.authorize({ accountId: "account-a", codeChallenge: "x".repeat(43), redirect: "genoffice://auth/callback" }),
    (error) => error.code === "forbidden" && error.fields.reason === "redirect_uri",
  );
  assert.equal(auth.codes.size, 0);
});

test("a hex code challenge is refused at authorize time", () => {
  // The defect: a server that compares hex would accept this and then never match
  // a compliant client's base64url challenge, failing later with no cause.
  const { auth } = setup();
  assert.throws(
    () => auth.authorize({ accountId: "account-a", codeChallenge: "a".repeat(64) }),
    (error) => error.code === "forbidden" && error.fields.reason === "code_challenge_malformed",
  );
  assert.equal(auth.codes.size, 0);
});

test("a non-S256 method is refused", () => {
  const { auth } = setup();
  assert.throws(
    () => auth.authorize({ accountId: "account-a", codeChallenge: "x".repeat(43), method: "plain" }),
    (error) => error.fields.reason === "code_challenge_method",
  );
});

test("a code expires on its own TTL and cannot be exchanged", () => {
  const { client, clock, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  clock.t += 61_000;
  assert.throws(
    () => client.complete({ code: codeOf(client, request.attemptId), state: request.state, redirect: REDIRECT_URI }),
    (error) => error.code === "authorization_code_expired",
  );
  assert.equal(sessions.size, 0);
});

test("a code is single-use on the server, even when the client asks twice", () => {
  const { auth, client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  const verifier = client.attempts.get(request.attemptId).verifier;
  const code = codeOf(client, request.attemptId);
  auth.redeem({ code, verifier, redirect: REDIRECT_URI });
  assert.throws(
    () => auth.redeem({ code, verifier, redirect: REDIRECT_URI }),
    (error) => error.code === "authorization_code_reused",
  );
  assert.equal(sessions.size, 1, "reuse must not mint a second session");
});

test("a stolen code is useless without the private verifier", () => {
  const { auth, client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  const code = codeOf(client, request.attemptId);
  assert.throws(
    () => auth.redeem({ code, verifier: "not-the-verifier".padEnd(64, "x"), redirect: REDIRECT_URI }),
    (error) => error.code === "forbidden" && error.fields.reason === "verifier_mismatch",
  );
  assert.equal(sessions.size, 0);
  // A malformed verifier is a different refusal, not a crash.
  assert.throws(
    () => auth.redeem({ code, verifier: "short", redirect: REDIRECT_URI }),
    (error) => error.fields.reason === "verifier_malformed",
  );
});

test("a swapped code from another attempt cannot complete this one", () => {
  const { client, sessions } = setup();
  const mine = client.begin({ accountId: "account-a" });
  const theirs = client.begin({ accountId: "account-b" });
  assert.throws(
    () => client.complete({ code: codeOf(client, theirs.attemptId), state: mine.state, redirect: REDIRECT_URI }),
    (error) => error.code === "forbidden",
  );
  assert.equal(sessions.size, 0);
});

test("an expired client attempt is refused even before the server is asked", () => {
  const { now, clock } = makeClock();
  const sessions = new Map();
  const auth = createAuthModel({ now, sessions, fail });
  const client = createClient({ auth, now, fail, attemptTtlMs: 1_000 });
  const request = client.begin({ accountId: "account-a" });
  clock.t += 2_000;
  assert.throws(
    () => client.complete({ code: codeOf(client, request.attemptId), state: request.state, redirect: REDIRECT_URI }),
    (error) => error.fields.reason === "attempt_expired",
  );
  assert.equal(sessions.size, 0);
});

test("completing an already-consumed attempt is refused", () => {
  const { client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  const code = codeOf(client, request.attemptId);
  client.complete({ code, state: request.state, redirect: REDIRECT_URI });
  assert.throws(
    () => client.complete({ code, state: request.state, redirect: REDIRECT_URI }),
    (error) => error.fields.reason === "unknown_attempt",
  );
  assert.equal(sessions.size, 1);
});

test("revocation and access expiry are the client's only two stops", () => {
  const { client, sessions } = setup();
  const request = client.begin({ accountId: "account-a" });
  const result = client.complete({ code: codeOf(client, request.attemptId), state: request.state, redirect: REDIRECT_URI });
  client.revoke(result.sessionId);
  assert.equal(sessions.get(result.sessionId).revoked, true);
});
