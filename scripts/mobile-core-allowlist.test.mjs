import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALLOWLIST, CORE, resolveCore, runtimeSpecifiers, target } from "./mobile-core-graph.mjs";

// ADR 0011: apps/chat-mobile imports only types and pure functions from
// packages/core. The M1 spec (§3.1) names those modules path by path, and the
// lint rule in the app will allow exactly them. A lint allowlist cannot see
// what a module pulls in transitively — usf's mobile boundary broke that way:
// barrel re-exports in core/{agents,permissions}/index.ts dragged TanStack,
// zustand and the web ApiClient into Metro. This test walks the runtime import
// graph of every allowlisted module and fails on the first thing a phone
// cannot carry, with the chain that reached it.

const root = path.resolve(import.meta.dirname, "..");

const BARE_ALLOWED = new Set(["zod"]);

// Files that exist only to talk to the browser or the web transport.
// runtime-config.ts is not one: it reads no env and the app calls configureRuntime() itself.
const FORBIDDEN_FILES = [
  `${CORE}/platform/`,
  `${CORE}/api/http.ts`,
  `${CORE}/api/session.ts`,
];

function violation(file, t) {
  if (t.bare) return BARE_ALLOWED.has(t.bare) ? null : `bare import "${t.bare}"`;
  if (t.unresolved) return `unresolvable import ${t.unresolved}`;
  if (t.file.endsWith(".tsx")) return `${t.file} is a .tsx (React) module`;
  const hit = FORBIDDEN_FILES.find((f) => t.file.startsWith(f));
  return hit ? `${t.file} (web-only: ${hit})` : null;
}

test("every allowlisted module resolves to a file, never a barrel", () => {
  for (const entry of ALLOWLIST) {
    const file = resolveCore(entry);
    assert.ok(file, `allowlist entry "${entry}" does not resolve under ${CORE}`);
    assert.ok(!file.endsWith("/index.ts"), `allowlist entry "${entry}" is a barrel (${file}); name the file instead`);
  }
});

test("no allowlisted module reaches a web-only or stateful dependency at runtime", () => {
  const failures = [];
  const seen = new Set(); // one chain per (entry, reason): http.ts is reached from many endpoints
  for (const entry of ALLOWLIST) {
    const start = resolveCore(entry);
    if (!start) continue; // the test above names it
    const parent = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const file = queue.shift();
      for (const spec of runtimeSpecifiers(file)) {
        const t = target(spec, file);
        const why = violation(file, t);
        if (why) {
          if (seen.has(`${entry}|${why}`)) continue;
          seen.add(`${entry}|${why}`);
          const chain = [];
          for (let f = file; f; f = parent.get(f)) chain.unshift(f);
          failures.push(`${entry}: ${why}\n    ${[...chain, spec].join("\n    -> ")}`);
          continue;
        }
        if (t.file && !parent.has(t.file)) {
          parent.set(t.file, file);
          queue.push(t.file);
        }
      }
    }
  }
  assert.deepEqual(
    failures, [],
    "ADR 0011: an allowlisted core module pulls the web into Metro. Split the " +
    "pure part into its own file and allowlist that, or drop the entry:\n" +
    failures.join("\n"),
  );
});

// The lint rule allows these subpaths, so each must be reachable through the
// package's `exports` map — a literal key, or a `/*` pattern it falls under —
// or Metro cannot resolve what the lint lets through.
test("every allowlisted module is reachable through packages/core exports", () => {
  const { exports: map } = JSON.parse(fs.readFileSync(path.join(root, CORE, "package.json"), "utf8"));
  const keys = Object.keys(map);
  const missing = ALLOWLIST.map((e) => `./${e}`).filter(
    (sub) => !keys.some((k) => k === sub || (k.endsWith("/*") && sub.startsWith(k.slice(0, -1)))),
  );
  assert.deepEqual(missing, [], `add these to ${CORE}/package.json exports: ${missing.join(", ")}`);
});
