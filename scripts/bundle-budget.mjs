#!/usr/bin/env node
// Bundle size budget (spec F-11 §6.6, Vision §6.3): what a visitor actually
// downloads for a route — the shared chunks plus that route's own — ≤ 400 KB
// gzip. Routes that already exceed it are ratcheted in
// scripts/bundle-budget.json: a ceiling at their current size, so a
// regression still fails and the number can only go down. Reads the
// artefacts of `pnpm --filter @uniwork/web build` (Turbopack); nothing
// beyond node.
//
// The budget is a TOTAL, not "own chunks", because "shared" is not a property
// of the code — it is the intersection over every route, and it moves when one
// route legitimately stops sharing. An earlier arrangement mounted the app
// providers under an `(app)` route group so the public landing page could skip
// them; that dropped the intersection from 245 KB to 42 KB and pushed the same
// unchanged bytes into every route's own column, which the old metric read as
// a 200 KB regression on twenty routes that had not changed at all. That group
// has since been rolled back, but the lesson stands: a total cannot be gamed
// by moving a mount point, so the metric stays a total.
//
//   node scripts/bundle-budget.mjs            # check
//   node scripts/bundle-budget.mjs --print    # list every route
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const ROUTE_KB = 400;
const root = path.resolve(import.meta.dirname, "..");
const next = path.join(root, "apps/web/.next");
const buildManifest = path.join(next, "build-manifest.json");
if (!fs.existsSync(buildManifest)) {
  console.error(`bundle-budget: ${buildManifest} missing — run \`pnpm --filter @uniwork/web build\` first`);
  process.exit(2);
}
const build = JSON.parse(fs.readFileSync(buildManifest, "utf8"));

const sizes = new Map();
function gzipKB(file) {
  if (!sizes.has(file)) {
    const p = path.join(next, file);
    sizes.set(file, fs.existsSync(p) && file.endsWith(".js") ? gzipSync(fs.readFileSync(p)).length / 1024 : 0);
  }
  return sizes.get(file);
}
const sum = (files) => [...new Set(files)].reduce((n, f) => n + gzipKB(f), 0);

const ceilings = JSON.parse(fs.readFileSync(path.join(root, "scripts/bundle-budget.json"), "utf8"));

// Every route's client chunks, from server/app/<route>/page_client-reference-manifest.js.
function* routeManifests(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* routeManifests(p);
    else if (e.name === "page_client-reference-manifest.js") yield p;
  }
}
const routes = new Map();
for (const file of routeManifests(path.join(next, "server/app"))) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  for (const [route, m] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
    const files = new Set([...Object.values(m.entryJSFiles ?? {}).flat(), ...(build.polyfillFiles ?? [])]);
    routes.set(route.replace(/\/page$/, "") || "/", files);
  }
}
// Initial = what every route loads (the intersection); the global error page
// is a stripped shell and would empty the set, so it is left out.
let shared = null;
for (const [route, files] of routes) {
  if (route === "/_global-error") continue;
  shared = shared ? new Set([...shared].filter((f) => files.has(f))) : new Set(files);
}
shared ??= new Set();
const initial = sum([...shared]);
const failures = [];
const rows = [];
for (const [route, files] of routes) {
  const total = sum([...files]);
  const ceiling = ceilings[route] ?? ROUTE_KB;
  rows.push([route, total, ceiling]);
  if (total > ceiling) failures.push(`${route} ${total.toFixed(1)} KB > ${ceiling} KB${ceilings[route] ? " (ratchet in scripts/bundle-budget.json)" : ""}`);
}

if (process.argv.includes("--print")) {
  console.log(`shared across every route: ${initial.toFixed(1)} KB gzip`);
  for (const [route, kb, ceiling] of rows.sort((a, b) => b[1] - a[1])) {
    console.log(`${kb.toFixed(1).padStart(7)} KB / ${String(ceiling).padStart(3)}  ${route}`);
  }
}
if (failures.length) {
  console.error("bundle-budget: over budget\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(`bundle-budget: ok — ${rows.length} routes within budget (${ROUTE_KB} KB gzip each, shared ${initial.toFixed(1)} KB)`);
