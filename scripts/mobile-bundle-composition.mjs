#!/usr/bin/env node
// What UniChat mobile's JS bundle is made of (audit bundle-size-growth): the
// budget (mobile-bundle-budget.mjs) holds the totals; this says which packages
// they are, and which moved since apps/chat-mobile/bundle-composition.json was
// last written, so a PR that adds weight names it in the job summary instead of
// only raising a total. It reads the source map `expo export --dump-sourcemap`
// writes: each module is attributed to its package (the last node_modules/
// segment of its path; the app's own files by top folder; packages/core as
// @uniwork/core) and sized by its source text in the map, the closest per-module
// measure a Hermes map gives (bytecode is not split per module).
//
//   node scripts/mobile-bundle-composition.mjs <export-dir> [--platform android] [--top 20] [--write]
//
// Report only, never a gate: the budget is the gate. --write refreshes the
// baseline; do it in the commit that changes the budget, so the next PR's
// deltas are its own.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const BASELINE_FILE = path.join(root, "apps/chat-mobile/bundle-composition.json");

/** The package a module of the bundle belongs to, from its path in the source map. */
export function packageOf(source) {
  const file = source.replace(/\\/g, "/");
  const at = file.lastIndexOf("node_modules/");
  if (at >= 0) {
    const [scope, name] = file.slice(at + "node_modules/".length).split("/");
    return scope?.startsWith("@") && name ? `${scope}/${name}` : (scope ?? file);
  }
  if (/(^|\/)packages\/core\//.test(file)) return "@uniwork/core";
  const app = /(?:^|\/)apps\/chat-mobile\/([^/]+)\//.exec(file) ?? /^(?:\.\/)?([^./][^/]*)\//.exec(file);
  return app ? `(app) ${app[1]}` : "(other)";
}

/** Each package's module count and source bytes, largest first. */
export function compose(map) {
  const sources = Array.isArray(map?.sources) ? map.sources : [];
  const contents = Array.isArray(map?.sourcesContent) ? map.sourcesContent : [];
  const byPackage = new Map();
  sources.forEach((source, index) => {
    const name = packageOf(String(source));
    const entry = byPackage.get(name) ?? { name, modules: 0, bytes: 0 };
    entry.modules += 1;
    entry.bytes += typeof contents[index] === "string" ? Buffer.byteLength(contents[index]) : 0;
    byPackage.set(name, entry);
  });
  return [...byPackage.values()].sort((a, b) => b.bytes - a.bytes || b.modules - a.modules || a.name.localeCompare(b.name));
}

/** What moved against the baseline: packages added, grown, shrunk or gone, largest change first. */
export function deltas(current, baseline) {
  const before = new Map((baseline ?? []).map((p) => [p.name, p]));
  const after = new Map(current.map((p) => [p.name, p]));
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names]
    .map((name) => {
      const was = before.get(name) ?? { bytes: 0, modules: 0 };
      const now = after.get(name) ?? { bytes: 0, modules: 0 };
      return { name, bytes: now.bytes - was.bytes, modules: now.modules - was.modules, added: !before.has(name), removed: !after.has(name) };
    })
    .filter((d) => d.bytes !== 0 || d.modules !== 0)
    .sort((a, b) => Math.abs(b.bytes) - Math.abs(a.bytes) || a.name.localeCompare(b.name));
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const signed = (bytes) => `${bytes > 0 ? "+" : bytes < 0 ? "−" : ""}${kb(Math.abs(bytes))}`;

export function report(platform, current, moved, top) {
  const lines = [`### UniChat ${platform} bundle composition (source bytes per package)`, "", "| package | modules | source |", "| --- | ---: | ---: |"];
  for (const p of current.slice(0, top)) lines.push(`| \`${p.name}\` | ${p.modules} | ${kb(p.bytes)} |`);
  lines.push("", moved === null ? "No baseline (apps/chat-mobile/bundle-composition.json): no deltas." : moved.length === 0 ? "No change against the baseline." : "");
  if (moved?.length) {
    lines.push("| moved since the baseline | modules | source |", "| --- | ---: | ---: |");
    for (const d of moved.slice(0, top)) {
      const note = d.added ? " (new)" : d.removed ? " (gone)" : "";
      lines.push(`| \`${d.name}\`${note} | ${d.modules > 0 ? "+" : ""}${d.modules} | ${signed(d.bytes)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir || dir.startsWith("--")) {
    console.error("usage: node scripts/mobile-bundle-composition.mjs <expo export output dir> [--platform android] [--top 20] [--write]");
    process.exit(2);
  }
  const platform = option(args, "platform", "android");
  const top = Number(option(args, "top", "20"));
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
  const rel = metadata?.fileMetadata?.[platform]?.bundle;
  if (typeof rel !== "string") throw new Error(`mobile-bundle-composition: ${dir}/metadata.json names no ${platform} bundle`);
  const current = compose(JSON.parse(fs.readFileSync(path.join(dir, `${rel}.map`), "utf8")));
  const baselines = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) : {};
  const text = report(platform, current, baselines[platform] ? deltas(current, baselines[platform]) : null, top);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (args.includes("--write")) {
    const next = { _: baselines._ ?? "Per-package source bytes of the JS bundle (scripts/mobile-bundle-composition.mjs --write); the baseline each PR's deltas are read against.", ...baselines, [platform]: current };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`wrote apps/chat-mobile/bundle-composition.json › ${platform}`);
  }
}
