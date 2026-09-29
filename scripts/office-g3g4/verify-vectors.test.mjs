#!/usr/bin/env node
// Node 22 built-in verifier for the G3-G4 contract vectors. This is a tiny
// deterministic check, not a product auth implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = join(here, "..", "..", "docs", "office", "g3g4", "vectors");
const pkce = JSON.parse(await readFile(join(vectors, "pkce-rfc7636.json"), "utf8"));
const callbacks = JSON.parse(await readFile(join(vectors, "callback-rejections.json"), "utf8"));

test("RFC 7636 appendix B S256 challenge is reproduced", () => {
  assert.equal(pkce.code_challenge_method, "S256");
  const actual = createHash("sha256")
    .update(Buffer.from(pkce.code_verifier, "ascii"))
    .digest()
    .toString("base64url");
  assert.equal(actual, pkce.code_challenge);
});

test("every callback rejection vector is rejected with auth_code_invalid", () => {
  assert.equal(callbacks.length, 8, "callback vector set changed");
  const exactRedirect = "uniwork-office://auth/callback";
  const isSingleString = (value) => typeof value === "string" && value.length > 0;
  for (const vector of callbacks) {
    const { query, pending } = vector;
    const rejected = !pending
      || !isSingleString(query.code)
      || !isSingleString(query.state)
      || query.state !== pending.state
      || pending.redirect_uri !== exactRedirect
      || (vector.callback_redirect ?? exactRedirect) !== exactRedirect
      || (vector.callback_deployment ?? pending.deployment_id) !== pending.deployment_id
      || vector.code_redeemed === true
      || (pending.expires_at && new Date(vector.now ?? new Date().toISOString()) >= new Date(pending.expires_at));
    assert.ok(rejected, `${vector.id}: vector was not rejected`);
    assert.equal(vector.expected_error, "auth_code_invalid", `${vector.id}: expected_error`);
  }
  console.log(`verified RFC 7636 S256 vector and ${callbacks.length} callback rejection vectors`);
});
