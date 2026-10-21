#!/usr/bin/env node
// UniChat mobile's JS budget (audit H3). Reads what
// `expo export --platform android --platform ios --dump-sourcemap` wrote and
// holds three numbers per platform against apps/chat-mobile/bundle-budget.json
// (iOS since 2026-10-22: Metro builds its bundle on any OS): the Hermes bytecode
// the binary embeds, its gzip size (what an OTA update downloads) and the
// module count from the source map (a dependency that drags a tree in shows
// up here first). Blocks at every GATE_LEVEL (ADR 0037): mobile-verify.yml
// runs only for PRs that reach the app.
//
//   node scripts/mobile-bundle-budget.mjs <export-dir>
//
// A ceiling is lowered when the bundle shrinks and raised only in the commit
// that adds the weight, with the reason in its body.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const BUDGET_FILE = path.join(root, "apps/chat-mobile/bundle-budget.json");

export const PLATFORMS = ["android", "ios"];

/** One platform's bundle numbers, from an `expo export` output directory. */
export function measure(dir, platform = "android") {
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
  const rel = metadata?.fileMetadata?.[platform]?.bundle;
  if (typeof rel !== "string") throw new Error(`mobile-bundle-budget: ${dir}/metadata.json names no ${platform} bundle`);
  const bytes = fs.readFileSync(path.join(dir, rel));
  const map = path.join(dir, `${rel}.map`);
  const modules = fs.existsSync(map) ? JSON.parse(fs.readFileSync(map, "utf8")).sources.length : null;
  return { bundle: rel, bundleKB: bytes.length / 1024, gzipKB: gzipSync(bytes, { level: 9 }).length / 1024, modules };
}

const ROWS = [
  ["bundleKB", "Hermes bytecode (KB)"],
  ["gzipKB", "gzip, an OTA download (KB)"],
  ["modules", "modules"],
];

/** Each number against its ceiling; `over` lists what broke it. */
export function check(measured, budget) {
  const rows = ROWS.map(([key, label]) => {
    const value = measured[key];
    const ceiling = budget[key];
    return { key, label, value, ceiling, over: value !== null && typeof ceiling === "number" && value > ceiling };
  });
  return { rows, over: rows.filter((r) => r.over) };
}

function format(value) {
  return value === null || value === undefined ? "–" : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function table(rows) {
  const lines = ["| | measured | ceiling | |", "| --- | ---: | ---: | --- |"];
  for (const r of rows) {
    const headroom = r.value !== null && r.ceiling ? `${(((r.ceiling - r.value) / r.ceiling) * 100).toFixed(1)}% left` : "";
    lines.push(`| ${r.label} | ${format(r.value)} | ${format(r.ceiling)} | ${r.over ? "**over**" : headroom} |`);
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/mobile-bundle-budget.mjs <expo export output dir>");
    process.exit(2);
  }
  const budgets = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  let failed = false;
  // Every platform the budget names must be in the export: a platform dropped from the export is not a pass.
  for (const platform of PLATFORMS) {
    const measured = measure(dir, platform);
    const { rows, over } = check(measured, budgets[platform] ?? {});
    const report = `### UniChat ${platform === "ios" ? "iOS" : "Android"} JS bundle\n\n\`${measured.bundle}\`\n\n${table(rows)}\n`;
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    for (const r of rows) {
      // A ceiling far above the bundle stops guarding it: say so, so it gets lowered.
      if (!r.over && r.value !== null && r.ceiling && r.value < r.ceiling * 0.9) {
        console.log(`::notice::${platform} ${r.label} is ${format(r.value)}, more than 10% under its ceiling ${r.ceiling}; lower it in apps/chat-mobile/bundle-budget.json`);
      }
    }
    for (const r of over) console.log(`::error::${platform} ${r.label} ${format(r.value)} is over the ceiling ${r.ceiling} (apps/chat-mobile/bundle-budget.json)`);
    failed ||= over.length > 0;
  }
  if (failed) process.exit(1);
}
