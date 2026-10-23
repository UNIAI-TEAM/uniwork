#!/usr/bin/env node
// Writes assets/licenses.json: every third-party package UniChat mobile ships
// with, as [name, version, the license its package.json states] (a row links
// to the package's npm page, so no URL is stored), for
// Settings › Privacy & legal › Open-source licenses
// (components/settings/licenses-list.tsx). It walks the app's `dependencies`
// and their own dependencies (optional ones when installed) through pnpm's
// node_modules; peers are listed where they are installed as dependencies.
// Left out: the workspace's own packages (@uniwork/*, private) and builds
// pinned to one OS or CPU (`os`/`cpu`), which differ between a laptop and CI.
// lib/licenses.test.ts runs this with --check, so a dependency change that
// leaves the file stale fails the suite. Run:
//   node apps/chat-mobile/scripts/generate-licenses.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const outFile = path.join(appRoot, "assets", "licenses.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Node's lookup: the nearest node_modules/<name> at or above `fromDir`. */
function locate(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseOf(pkg) {
  const value = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l?.type ?? l).join(" OR ") : pkg.licenses?.type);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function collectLicenses() {
  const root = readJson(path.join(appRoot, "package.json"));
  const seen = new Set();
  const out = new Map();
  const queue = Object.keys(root.dependencies ?? {}).map((name) => ({ name, from: appRoot, optional: false }));
  while (queue.length > 0) {
    const { name, from, optional } = queue.shift();
    const file = locate(name, from);
    if (!file) {
      if (optional) continue;
      throw new Error(`${name} is a dependency but is not installed (run pnpm install)`);
    }
    if (seen.has(file)) continue;
    seen.add(file);
    const pkg = readJson(file);
    if (pkg.os || pkg.cpu) continue;
    const dir = path.dirname(file);
    const own = pkg.private === true || String(pkg.name).startsWith("@uniwork/");
    if (!own) {
      const key = `${pkg.name}@${pkg.version}`;
      out.set(key, [pkg.name, pkg.version, licenseOf(pkg)]);
    }
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir, optional: false });
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dep, from: dir, optional: true });
  }
  return [...out.values()].sort((a, b) => a[0].localeCompare(b[0], "en") || a[1].localeCompare(b[1], "en"));
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // One package per line: a dependency bump is a one-line diff.
  const rows = collectLicenses();
  const next = `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (current !== next) {
      console.error(`${path.relative(process.cwd(), outFile)} is stale; run scripts/generate-licenses.mjs`);
      process.exit(1);
    }
  } else if (current !== next) {
    fs.writeFileSync(outFile, next);
    console.log(`wrote ${path.relative(process.cwd(), outFile)} (${rows.length} packages)`);
  }
}
