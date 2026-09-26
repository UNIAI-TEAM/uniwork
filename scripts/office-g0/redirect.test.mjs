import { test } from "node:test";
import assert from "node:assert/strict";

import { FOREIGN_REDIRECT_URI, REDIRECT_URI, isRegisteredCallback, parseCallback } from "./redirect.mjs";

test("the registered callback is the one exact string", () => {
  assert.equal(REDIRECT_URI, "uniwork-office://auth/callback");
  assert.equal(FOREIGN_REDIRECT_URI, "genoffice://auth/callback");
});

test("the exact callback passes, every near miss fails", () => {
  assert.equal(isRegisteredCallback("uniwork-office://auth/callback"), true);
  assert.equal(isRegisteredCallback("uniwork-office://auth/callback?code=c&state=s"), true);
  // Near misses: a trailing slash, an extra segment, a suffix, another scheme.
  for (const bad of [
    "uniwork-office://auth/callback/",
    "uniwork-office://auth/callback/extra",
    "uniwork-office://auth/callbackx",
    "uniwork-office://auth",
    "genoffice://auth/callback?code=c",
    "https://auth.example/callback",
    "uniwork-office://evil.example/auth/callback",
    "not a url",
    "",
    undefined,
  ]) {
    assert.equal(isRegisteredCallback(bad), false, JSON.stringify(bad) + " must not be accepted");
  }
});

test("parsing keeps code and state verbatim", () => {
  const parsed = parseCallback("uniwork-office://auth/callback?code=a%2Bb&state=s-1_2&extra=x");
  assert.equal(parsed.scheme, "uniwork-office");
  assert.equal(parsed.code, "a+b");
  assert.equal(parsed.state, "s-1_2");
  assert.equal(parseCallback("https://x/y")?.scheme, "https");
});
