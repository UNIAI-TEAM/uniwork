import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const grep = (pattern) =>
  execSync(
    `grep -rnE -e ${JSON.stringify(pattern)} packages apps e2e ` +
      `--include='*.ts' --include='*.tsx' --include='*.css' --include='*.mdx' ` +
      `| grep -v node_modules | grep -v '\\.next/' | grep -v tsbuildinfo | grep -v 'tokens.test.ts' || true`,
    { encoding: "utf8" },
  ).trim();

// The --uw-* palette was retired at the end of the base port (phase 5). A
// `var(--uw-…)` resolves to nothing — the browser falls back to an inherited
// colour and no tool reports it — so the only cheap guard is a grep.
test("no --uw-* token references remain", () => {
  const hits = grep("--uw-");
  assert.equal(hits, "", `--uw-* references:\n${hits}`);
});

// The pre-port utility names (bg-canvas, text-tertiary, border-line-loud, …)
// no longer resolve to anything in @theme; Tailwind silently emits no CSS
// for an unknown class.
test("no legacy token utilities remain", () => {
  const LEGACY =
    "canvas|subtle|text-secondary|tertiary|inverse|line|line-strong|line-loud|on-brand|danger|danger-text|success-text|warning-text|brand-soft";
  const hits = grep(`[^a-zA-Z0-9_-](bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|placeholder|decoration)-(${LEGACY})([^a-zA-Z0-9_-]|$)`);
  assert.equal(hits, "", `legacy utilities:\n${hits}`);
});
