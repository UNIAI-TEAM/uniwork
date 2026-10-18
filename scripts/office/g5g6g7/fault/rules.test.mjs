import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION_TYPES, createRuleEngine, stripQuery, validateRule, validateRules } from "./rules.mjs";

test("stripQuery removes query strings and fragments and normalizes full URLs", () => {
  assert.equal(stripQuery("/api/v1/documents/doc1/versions?cursor=abc&limit=50"), "/api/v1/documents/doc1/versions");
  assert.equal(stripQuery("/api/v1/office-frame/documents/doc1/assets/a1?sig=secret#part"), "/api/v1/office-frame/documents/doc1/assets/a1");
  assert.equal(stripQuery("http://127.0.0.1:8080/api/v1/documents/doc1?token=secret"), "/api/v1/documents/doc1");
  assert.equal(stripQuery(""), "/");
});

test("validateRule and validateRules accept all seven action types and reject malformed rules", () => {
  assert.deepEqual(
    [...ACTION_TYPES],
    ["delay", "drop_request", "drop_response_after_forward", "status", "reset", "hold", "rewrite_json"],
  );

  const valid = validateRules([
    { id: "r-delay", match: { method: "post", path: "^/api/v1/documents/.*/versions/commit$" }, action: { type: "delay", ms: 25 } },
    { id: "r-drop-req", match: { path: "/uploads$" }, action: { type: "drop_request" }, once: true },
    { id: "r-drop-res", match: { method: "POST", path: "/commit$", nth: 2 }, action: { type: "drop_response_after_forward" } },
    { id: "r-status", match: { path: "/status$" }, action: { type: "status", code: 503, body: { error: "unavailable" } } },
    { id: "r-reset", match: { path: "/reset$" }, action: { type: "reset" } },
    { id: "r-hold", match: { path: "/hold$" }, action: { type: "hold", until: "release" } },
    {
      id: "r-rewrite",
      match: { method: "PUT", path: "^/api/v1/documents/[^/]+/office/offline-lease$" },
      action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: 120000 }, lease_state: "active" } },
    },
  ]);
  assert.equal(valid.length, 7);
  assert.equal(valid[0].match.method, "POST");
  assert.equal(valid[1].once, true);
  assert.equal(valid[2].match.nth, 2);

  assert.throws(() => validateRule({ id: "", match: { path: "/a" }, action: { type: "reset" } }), /id must be a non-empty string/);
  assert.throws(() => validateRule({ id: "bad-regex", match: { path: "[unclosed" }, action: { type: "reset" } }), /invalid match\.path regex/);
  assert.throws(() => validateRule({ id: "bad-nth", match: { path: "/a", nth: 0 }, action: { type: "reset" } }), /match\.nth must be a positive integer/);
  assert.throws(() => validateRule({ id: "bad-action", match: { path: "/a" }, action: { type: "unknown" } }), /unsupported action\.type/);
  assert.throws(() => validateRule({ id: "bad-delay", match: { path: "/a" }, action: { type: "delay", ms: -1 } }), /non-negative ms/);
  assert.throws(() => validateRule({ id: "bad-status", match: { path: "/a" }, action: { type: "status", code: 99 } }), /integer HTTP code/);
  assert.throws(() => validateRule({ id: "bad-hold", match: { path: "/a" }, action: { type: "hold", until: "forever" } }), /until="release"/);
  assert.throws(() => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json" } }), /requires a patch object/);
  assert.throws(() => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: {} } }), /requires a non-empty patch object/);
  assert.throws(() => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: [1, 2] } }), /requires a patch object/);
  assert.throws(() => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: "expires_at" } }), /requires a patch object/);
  assert.throws(() => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: { "": 1 } } }), /patch keys must be non-empty strings/);
  assert.throws(
    () => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: -1 } } } }),
    /now_plus_ms must be a non-negative integer/,
  );
  assert.throws(
    () => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: 1.5 } } } }),
    /now_plus_ms must be a non-negative integer/,
  );
  assert.throws(
    () => validateRule({ id: "bad-rewrite", match: { path: "/a" }, action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: "soon" } } } }),
    /now_plus_ms must be a non-negative integer/,
  );
  assert.throws(
    () =>
      validateRules([
        { id: "dup", match: { path: "/a" }, action: { type: "reset" } },
        { id: "dup", match: { path: "/b" }, action: { type: "reset" } },
      ]),
    /duplicate rule id "dup"/,
  );
});

test("rewrite_json normalizes its patch, deep-copies it, and leaves other action types untouched", () => {
  const rule = validateRule({
    id: "lease-rewrite",
    match: { method: "PUT", path: "^/api/v1/documents/[^/]+/office/offline-lease$" },
    action: {
      type: "rewrite_json",
      patch: {
        expires_at: { now_plus_ms: 120000 },
        lease_state: "active",
        nested: { keep: [1, { deep: true }] },
      },
    },
  });
  assert.equal(rule.action.type, "rewrite_json");
  assert.deepEqual(rule.action.patch, {
    expires_at: { now_plus_ms: 120000 },
    lease_state: "active",
    nested: { keep: [1, { deep: true }] },
  });

  // The patch is deep-copied: mutating the source never leaks into the normalized rule.
  const sourcePatch = { expires_at: { now_plus_ms: 1000 }, nested: { keep: [1, 2] } };
  const copied = validateRule({
    id: "copied-rewrite",
    match: { path: "/lease$" },
    action: { type: "rewrite_json", patch: sourcePatch },
  });
  sourcePatch.expires_at.now_plus_ms = 999999;
  sourcePatch.nested.keep.push(3);
  assert.deepEqual(copied.action.patch, { expires_at: { now_plus_ms: 1000 }, nested: { keep: [1, 2] } });

  // now_plus_ms = 0 is a valid non-negative integer.
  const zero = validateRule({
    id: "zero-rewrite",
    match: { path: "/lease$" },
    action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: 0 } } },
  });
  assert.deepEqual(zero.action.patch, { expires_at: { now_plus_ms: 0 } });

  // An object with now_plus_ms plus another key is applied literally, not resolved.
  const literal = validateRule({
    id: "literal-rewrite",
    match: { path: "/lease$" },
    action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: 5, unit: "ms" } } },
  });
  assert.deepEqual(literal.action.patch, { expires_at: { now_plus_ms: 5, unit: "ms" } });

  // Other action types keep their normalized shape (no patch key added).
  const delayRule = validateRule({ id: "plain-delay", match: { path: "/a" }, action: { type: "delay", ms: 5 } });
  assert.deepEqual(delayRule.action, { type: "delay", ms: 5 });
  const holdRule = validateRule({ id: "plain-hold", match: { path: "/a" }, action: { type: "hold" } });
  assert.deepEqual(holdRule.action, { type: "hold", until: "release" });
  const resetRule = validateRule({ id: "plain-reset", match: { path: "/a" }, action: { type: "reset" } });
  assert.deepEqual(resetRule.action, { type: "reset" });
});

test("first matching rule wins and once rules disarm after the first hit", () => {
  const engine = createRuleEngine([
    {
      id: "first-once",
      match: { method: "POST", path: "^/api/v1/documents/[^/]+/versions/commit$" },
      action: { type: "drop_response_after_forward" },
      once: true,
    },
    {
      id: "second-fallback",
      match: { method: "POST", path: "^/api/v1/documents/[^/]+/versions/commit$" },
      action: { type: "status", code: 409, body: { error: "document_version_conflict" } },
    },
  ]);

  const hit1 = engine.matchRequest({
    method: "POST",
    path: "/api/v1/documents/doc_1/versions/commit?trace=1",
  });
  assert.equal(hit1?.ruleId, "first-once");
  assert.equal(hit1?.action.type, "drop_response_after_forward");

  // Second request to the same path skips the disarmed `once` rule and hits `second-fallback`.
  const hit2 = engine.matchRequest({
    method: "POST",
    path: "/api/v1/documents/doc_1/versions/commit",
  });
  assert.equal(hit2?.ruleId, "second-fallback");
  assert.equal(hit2?.action.type, "status");
  assert.equal(hit2?.action.code, 409);

  // Method mismatch does not match either rule.
  const miss = engine.matchRequest({
    method: "GET",
    path: "/api/v1/documents/doc_1/versions/commit",
  });
  assert.equal(miss, null);
});

test("nth (1-based) triggers only on the nth matching request", () => {
  const engine = createRuleEngine([
    {
      id: "third-commit-fails",
      match: { method: "POST", path: "/versions/commit$", nth: 3 },
      action: { type: "reset" },
    },
  ]);

  assert.equal(engine.matchRequest({ method: "POST", path: "/api/v1/documents/d1/versions/commit" }), null);
  assert.equal(engine.matchRequest({ method: "POST", path: "/api/v1/documents/d1/versions/commit" }), null);

  const third = engine.matchRequest({ method: "POST", path: "/api/v1/documents/d1/versions/commit" });
  assert.equal(third?.ruleId, "third-commit-fails");
  assert.equal(third?.action.type, "reset");

  // 4th request does not match nth=3.
  assert.equal(engine.matchRequest({ method: "POST", path: "/api/v1/documents/d1/versions/commit" }), null);
});

test("hold action blocks until release(ruleId) is called", async () => {
  const engine = createRuleEngine([
    {
      id: "hold-commit",
      match: { method: "POST", path: "/versions/commit$" },
      action: { type: "hold", until: "release" },
    },
  ]);

  const match = engine.matchRequest({ method: "POST", path: "/api/v1/documents/d1/versions/commit" });
  assert.equal(match?.ruleId, "hold-commit");
  assert.ok(match?.waitForRelease instanceof Promise);
  assert.equal(engine.getRules()[0].held, 1);

  let resolved = false;
  match.waitForRelease.then(() => {
    resolved = true;
  });

  await new Promise((r) => setTimeout(r, 15));
  assert.equal(resolved, false);

  const releaseResult = engine.release("hold-commit");
  assert.deepEqual(releaseResult, { ruleId: "hold-commit", released: 1 });

  await match.waitForRelease;
  assert.equal(resolved, true);
  assert.equal(engine.getRules()[0].held, 0);
});
