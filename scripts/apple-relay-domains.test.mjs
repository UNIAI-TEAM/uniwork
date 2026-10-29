import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Which addresses are Sign in with Apple's Hide My Email relay is decided on
// both sides of the API: the server's appleRelayDomains drives identity
// resolution, the Settings summary (private_relay, account_email_is_relay)
// and keeping Apple on a relay account; core's APPLE_RELAY_DOMAINS drives
// isAppleRelayEmail, which names the address "Email ẩn của Apple" on the web
// and the phone. Apple added private.icloud.com beside
// privaterelay.appleid.com in late 2026 (UNI-2287). A domain added on one side
// only fails quietly — a relay account allowed to unlink Apple, or a raw
// forwarding address on screen — so it fails here instead.

const GO = "server/internal/service/identity_resolve.go";
const TS = "packages/core/auth/sign-in-rules.ts";

/** The keys of `var appleRelayDomains = map[string]bool{…}`, declared at the start of a line (a commented-out one is not). */
function goDomains() {
  const decl = read(GO).match(/^var appleRelayDomains = map\[string\]bool\{([^}]*)\}/m);
  assert.ok(decl, `${GO} no longer declares appleRelayDomains as a map[string]bool literal`);
  return [...decl[1].matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]);
}

/** The strings of `export const APPLE_RELAY_DOMAINS… = […]`. */
function tsDomains() {
  const decl = read(TS).match(/^export const APPLE_RELAY_DOMAINS(?::[^=]+)? = \[([^\]]*)\]/m);
  assert.ok(decl, `${TS} no longer exports APPLE_RELAY_DOMAINS as an array literal`);
  return [...decl[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const sorted = (list) => [...list].sort();

test("the server and the clients know the same Apple relay domains", () => {
  const go = goDomains();
  const ts = tsDomains();
  assert.deepEqual(sorted(go), sorted(ts), `${GO} › appleRelayDomains and ${TS} › APPLE_RELAY_DOMAINS differ`);
  assert.equal(new Set(ts).size, ts.length, `${TS} lists a relay domain twice`);
  for (const domain of ts) {
    assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `"${domain}" is not a lower-case domain`);
  }
  // Apple keeps forwarding to the addresses it issued before the move.
  for (const domain of ["privaterelay.appleid.com", "private.icloud.com"]) {
    assert.ok(ts.includes(domain), `${domain} is not a relay domain any more`);
  }
});

const SKIP_DIRS = new Set(["node_modules", "coverage", "public", "dist", "build", ".next", ".expo", ".turbo", "testdata"]);

function* sources(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* sources(rel);
    } else if (/\.go$/.test(entry.name) ? !entry.name.endsWith("_test.go") : /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      yield rel;
    }
  }
}

test("no other source decides what a relay address is", () => {
  // A copy of the rule elsewhere is the next place a domain goes missing (the
  // phone kept one until UNI-2287). An OpenAPI example names an address, not
  // a rule, so a struct tag's `example:"…"` may.
  const domains = tsDomains();
  const copies = [];
  for (const dir of ["server", "packages", "apps"]) {
    for (const file of sources(dir)) {
      if (file === GO || file === TS) continue;
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (domains.some((d) => line.includes(d)) && !/\bexample:"[^"]*"/.test(line)) copies.push(`${file}:${i + 1}`);
        });
    }
  }
  assert.deepEqual(copies, [], `import isAppleRelayEmail (packages/core/auth/sign-in-rules.ts) or use isRelayAddress (${GO}) instead`);
});
