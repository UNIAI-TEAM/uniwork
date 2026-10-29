import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Which addresses are Sign in with Apple's Hide My Email relay is decided on
// both sides of the API: core's APPLE_RELAY_DOMAINS drives isAppleRelayEmail,
// which names the address "Email ẩn của Apple" on the web and the phone; the
// server's appleRelayDomains drives identity resolution and the Settings
// summary. Apple added private.icloud.com beside privaterelay.appleid.com in
// late 2026 (UNI-2287). The two lists are held equal, and the server's own
// sources scanned, by server/internal/service/apple_relay_domains_test.go,
// which the backend job runs on every pull request. This file holds the
// clients' sources, in the frontend job that a change under apps/ or
// packages/ runs.

const TS = "packages/core/auth/sign-in-rules.ts";

/**
 * The strings of `export const APPLE_RELAY_DOMAINS… = […]`. Any entry that is
 * not a plain string literal (a spread, a constant, a template) fails: it is a
 * domain the scan below would not look for.
 */
function relayDomains() {
  const decl = read(TS).match(/^export const APPLE_RELAY_DOMAINS(?::[^=]+)? = \[([^\]]*)\]/m);
  assert.ok(decl, `${TS} no longer exports APPLE_RELAY_DOMAINS as an array literal`);
  const body = decl[1].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const literal = /"([^"\\]*)"|'([^'\\]*)'/g;
  const rest = body.replace(literal, "").replace(/[\s,]/g, "");
  assert.equal(rest, "", `${TS} › APPLE_RELAY_DOMAINS holds an entry that is not a string literal`);
  return [...body.matchAll(literal)].map((m) => m[1] ?? m[2]);
}

/**
 * A relay domain as code may write it: whatever its case, its dots escaped or
 * in a class or not, and without its top-level label, so a split string
 * ("private.icloud" + ".com") is found too.
 */
function written(domains) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dot = String.raw`(?:\\*\.|\[\.\])`;
  return new RegExp(domains.map((d) => d.split(".").slice(0, -1).map(escape).join(dot)).join("|"), "i");
}

/** The tracked sources of the clients, tests aside, and the vendored office upstream, which is not ours. */
function clientSources() {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(
      (file) =>
        /\.[cm]?[jt]sx?$/.test(file) &&
        !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
        !file.startsWith("packages/office-upstream/upstream/") &&
        file !== TS &&
        fs.existsSync(path.join(root, file)),
    );
}

test("no client source decides what a relay address is", () => {
  // A copy of the rule elsewhere is the next place a domain goes missing (the
  // phone kept one until UNI-2287).
  const domains = relayDomains();
  assert.ok(domains.length > 0, `${TS} › APPLE_RELAY_DOMAINS is empty`);
  const pattern = written(domains);
  const copies = [];
  for (const file of clientSources()) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) copies.push(`${file}:${i + 1}`);
      });
  }
  assert.deepEqual(copies, [], `import isAppleRelayEmail from ${TS} instead`);
});
