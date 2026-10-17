#!/usr/bin/env node
// Copies the subtrees UniChat mobile uses from packages/core/i18n/locales into
// apps/chat-mobile/locales/{vi,en}.json, plus the few mobile-only strings
// below. The app never imports core's bundles (ADR 0011: types and pure
// functions only); lib/i18n.test.ts runs this with --check so a stale copy
// fails the suite. Run: node apps/chat-mobile/scripts/sync-i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreLocales = path.resolve(here, "../../../packages/core/i18n/locales");
const outDir = path.resolve(here, "../locales");

// Dotted paths into the core bundle; a path may name a subtree or one leaf.
const PATHS = [
  "auth.desktop",
  "auth.logout",
  "common",
  "nav",
  "settings.preferences",
  "workspace.pickTitle",
  "chat.no_conversation_hint",
];

// Strings no web screen has; keep vi and en aligned.
const MOBILE_ONLY = {
  vi: { mobile: { tab_calls: "Cuộc gọi" } },
  en: { mobile: { tab_calls: "Calls" } },
};

function get(obj, dotted) {
  return dotted.split(".").reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

function set(obj, dotted, value) {
  const keys = dotted.split(".");
  const leaf = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), obj);
  parent[leaf] = value;
}

function build(locale) {
  const core = JSON.parse(fs.readFileSync(path.join(coreLocales, `${locale}.json`), "utf8"));
  const out = {};
  for (const dotted of PATHS) {
    const value = get(core, dotted);
    if (value === undefined) throw new Error(`${locale}.json has no ${dotted}`);
    set(out, dotted, value);
  }
  return { ...out, ...MOBILE_ONLY[locale] };
}

const check = process.argv.includes("--check");
let stale = false;
for (const locale of Object.keys(MOBILE_ONLY)) {
  const file = path.join(outDir, `${locale}.json`);
  const next = `${JSON.stringify(build(locale), null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === next) continue;
  if (check) {
    stale = true;
    console.error(`${path.relative(process.cwd(), file)} is stale; run scripts/sync-i18n.mjs`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, next);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
process.exit(stale ? 1 : 0);
